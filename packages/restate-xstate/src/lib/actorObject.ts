import type {
  Actor,
  ActorSystemInfo,
  AnyActorLogic,
  AnyEventObject,
  AnyMachineSnapshot,
  AnyStateMachine,
  InputFrom,
  Observer,
  PromiseActorLogic,
  Snapshot,
} from "xstate";
import * as restate from "@restatedev/restate-sdk";
import {
  RESTATE_PROMISE_REJECT,
  RESTATE_PROMISE_RESOLVE,
} from "./constants.js";
import type {
  PromiseCreator,
  SerialisableActorRef,
  State,
  XStateOptions,
  SerialisableScheduledEvent,
  XStateApi,
  ActorObjectHandlers,
  Condition,
  Subscription,
  SnapshotWithTags,
} from "./types.js";
import { resolveReferencedActor } from "./utils.js";
import { createActor } from "./createActor.js";
import { createScheduledEventId, type RestateActorSystem } from "./system.js";
import {
  checkIfStateMachineShouldBeDisposed,
  validateStateMachineIsNotDisposed,
} from "./cleanupState..js";

async function getOrSetVersion<
  LatestVersion extends string,
  PreviousVersion extends string,
>(
  ctx: restate.ObjectContext<State>,
  latestVersion: LatestVersion,
): Promise<LatestVersion | PreviousVersion> {
  let version = (await ctx.get("version")) as
    | LatestVersion
    | PreviousVersion
    | null;
  if (version == null) {
    version = latestVersion;
    ctx.set("version", version);
  }
  return version;
}

function getLogic<
  LatestStateMachine extends AnyStateMachine,
  PreviousStateMachine extends AnyStateMachine,
>(
  latestLogic: LatestStateMachine,
  previousVersions: PreviousStateMachine[],
  version: string,
): LatestStateMachine | PreviousStateMachine {
  if (latestLogic.id === version) return latestLogic;
  const previousVersion = previousVersions.find((v) => v.id === version);
  if (previousVersion) {
    return previousVersion;
  }
  throw new restate.TerminalError(
    `The state refers to a version ${version} which is not present in the code`,
  );
}

export function actorObject<
  P extends string,
  LatestStateMachine extends AnyStateMachine,
  PreviousStateMachine extends AnyStateMachine,
>(
  path: P,
  latestLogic: LatestStateMachine,
  options?: XStateOptions<PreviousStateMachine>,
) {
  const api: XStateApi<string, LatestStateMachine> = {
    name: path,
  };

  const versions = options?.versions ?? [];

  return restate.object({
    name: path,
    handlers: {
      create: async (
        ctx: restate.ObjectContext<State>,
        request?: {
          input?: InputFrom<LatestStateMachine>;
        },
      ): Promise<Snapshot<unknown>> => {
        const systemName = ctx.key;

        ctx.clear("version");
        ctx.clear("snapshot");
        ctx.clear("events");
        ctx.clear("children");
        ctx.clear("disposed");
        ctx.clear("subscriptions");

        const version = await getOrSetVersion(ctx, latestLogic.id);
        const logic = getLogic(
          latestLogic,
          versions,
          version,
        ) as LatestStateMachine;

        const root = await createActor(ctx, api, systemName, version, logic, {
          input: {
            ...(request?.input ?? {}),
          } as InputFrom<LatestStateMachine>,
        });

        root.start();
        const snapshot = root.getPersistedSnapshot();

        ctx.set("snapshot", snapshot);

        await checkIfStateMachineShouldBeDisposed(
          ctx,
          api,
          systemName,
          options?.finalStateTTL,
        );

        return persistedSnapshotWithTags(root, snapshot);
      },
      send: async (
        ctx: restate.ObjectContext<State>,
        request?: {
          scheduledEvent?: SerialisableScheduledEvent;
          source?: SerialisableActorRef;
          target?: SerialisableActorRef;
          subscribe?: { condition: string; awakeableId: string };
          event: AnyEventObject;
        },
      ): Promise<Snapshot<unknown> | undefined> => {
        await validateStateMachineIsNotDisposed(ctx);
        const systemName = ctx.key;

        if (!request) {
          throw new restate.TerminalError("Must provide a request");
        }

        const version = await getOrSetVersion(ctx, latestLogic.id);
        const logic = getLogic(latestLogic, versions, version);

        if (request.scheduledEvent) {
          const events = (await ctx.get("events")) ?? {};
          const scheduledEventId = createScheduledEventId(
            request.scheduledEvent.source,
            request.scheduledEvent.id,
          );
          if (!(scheduledEventId in events)) {
            ctx.console.log(
              "Received now cancelled event",
              scheduledEventId,
              "for target",
              request.target,
            );
            return;
          }
          if (events[scheduledEventId]?.uuid !== request.scheduledEvent.uuid) {
            ctx.console.log(
              "Received now replaced event",
              scheduledEventId,
              "for target",
              request.target,
            );
            return;
          }
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete events[scheduledEventId];
          ctx.set("events", events);
        }

        const root = await createActor<
          PreviousStateMachine | LatestStateMachine
        >(ctx, api, systemName, version, logic);

        const subscriptions = (await ctx.get("subscriptions")) ?? {};

        if (
          request.subscribe &&
          !evaluateCondition(ctx, root, request.subscribe.condition, [
            request.subscribe.awakeableId,
          ])
        ) {
          const existingSubscription =
            subscriptions[request.subscribe.condition];
          if (existingSubscription) {
            existingSubscription.awakeables.push(request.subscribe.awakeableId);
          } else {
            subscriptions[request.subscribe.condition] = {
              awakeables: [request.subscribe.awakeableId],
            };
          }

          ctx.set("subscriptions", subscriptions);
        }

        root.subscribe(new ConditionObserver(ctx, root, subscriptions));

        root.start();

        let actor;
        if (request.target) {
          actor = (root.system as RestateActorSystem<ActorSystemInfo>).actor(
            request.target.sessionId,
          );
          if (!actor) {
            throw new restate.TerminalError(
              `Actor ${request.target.id} not found; it may have since stopped`,
            );
          }
        } else {
          actor = root;
        }

        (root.system as RestateActorSystem<ActorSystemInfo>)._relay(
          request.source,
          actor,
          request.event,
        );

        ctx.set("snapshot", root.getPersistedSnapshot());

        await checkIfStateMachineShouldBeDisposed(
          ctx,
          api,
          systemName,
          options?.finalStateTTL,
        );

        return persistedSnapshotWithTags(root);
      },
      subscribe: async (
        ctx: restate.ObjectContext<State>,
        request: { condition: string; awakeableId: string },
      ): Promise<void> => {
        await validateStateMachineIsNotDisposed(ctx);

        const systemName = ctx.key;

        // no need to set the version here if we are just reading
        let version = await ctx.get("version");
        if (version == null) {
          version = latestLogic.id;
        }
        const logic = getLogic(latestLogic, versions, version);

        const root = await createActor<
          LatestStateMachine | PreviousStateMachine
        >(ctx, api, systemName, version, logic);

        if (
          evaluateCondition(ctx, root, request.condition, [request.awakeableId])
        ) {
          // the condition is already met
          return;
        }

        const subscriptions = (await ctx.get("subscriptions")) ?? {};

        const existingSubscription = subscriptions[request.condition];
        if (existingSubscription) {
          existingSubscription.awakeables.push(request.awakeableId);
        } else {
          subscriptions[request.condition] = {
            awakeables: [request.awakeableId],
          };
        }

        ctx.set("subscriptions", subscriptions);
      },
      waitFor: restate.handlers.object.shared(
        async (
          ctx: restate.ObjectSharedContext<State>,
          request: {
            condition: Condition;
            timeout?: number;
            event?: AnyEventObject;
          },
        ) => {
          await validateStateMachineIsNotDisposed(ctx);
          validateCondition(request.condition);

          const systemName = ctx.key;

          const { id, promise } = ctx.awakeable<Snapshot<unknown>>();

          if (request.event) {
            // we use an unawaited promise so the trace id stays the same
            void ctx
              .objectClient<
                ActorObjectHandlers<LatestStateMachine | PreviousStateMachine>
              >(api, systemName)
              .send({
                subscribe: {
                  condition: request.condition,
                  awakeableId: id,
                },
                event: request.event,
              });
          } else {
            void ctx
              .objectClient<
                ActorObjectHandlers<LatestStateMachine | PreviousStateMachine>
              >(api, systemName)
              .subscribe({
                condition: request.condition,
                awakeableId: id,
              });
          }

          try {
            if (request.timeout !== undefined) {
              return await promise.orTimeout(request.timeout);
            } else {
              return await promise;
            }
          } catch (e) {
            if (!(e instanceof restate.TerminalError)) {
              // pass through transient errors
              throw e;
            }

            if (e.code != 500) {
              // errors that aren't from the awakeable being rejected, eg cancellation, timeout
              throw e;
            }

            // awakeable rejection, return http 412 so that clients know this is non-transient
            throw new restate.TerminalError(e.message, { errorCode: 412 });
          }
        },
      ),
      snapshot: async (
        ctx: restate.ObjectContext<State>,
      ): Promise<SnapshotWithTags> => {
        await validateStateMachineIsNotDisposed(ctx);
        const systemName = ctx.key;

        // no need to set the version here if we are just getting a snapshot
        let version = await ctx.get("version");
        if (version == null) {
          version = latestLogic.id;
        }
        const logic = getLogic(latestLogic, versions, version);

        const root = await createActor<
          LatestStateMachine | PreviousStateMachine
        >(ctx, api, systemName, version, logic);

        return persistedSnapshotWithTags(root);
      },
      invokePromiseRetry: restate.handlers.object.shared(
        async (
          ctx: restate.ObjectSharedContext<State>,
          {
            self,
            srcs,
            input,
            version,
          }: {
            self: SerialisableActorRef;
            srcs: string[];
            input: unknown;
            version?: string;
          },
        ) => {
          await validateStateMachineIsNotDisposed(ctx);

          const systemName = ctx.key;

          try {
            const response = await ctx
              .objectClient<
                ActorObjectHandlers<LatestStateMachine | PreviousStateMachine>
              >(api, systemName)
              .invokePromise({
                srcs,
                input,
                version,
              });

            void ctx
              .objectClient<
                ActorObjectHandlers<LatestStateMachine>
              >(api, systemName)
              .send({
                source: self,
                target: self,
                event: {
                  type: RESTATE_PROMISE_RESOLVE,
                  data: response,
                },
              });
          } catch (e) {
            if (e instanceof restate.TerminalError) {
              void ctx
                .objectClient<
                  ActorObjectHandlers<LatestStateMachine>
                >(api, systemName)
                .send({
                  source: self,
                  target: self,
                  event: {
                    type: RESTATE_PROMISE_REJECT,
                    data: e.message,
                  },
                });
            } else {
              // pass through non terminal errors
              throw e;
            }
          }
        },
      ),
      invokePromise: restate.handlers.object.shared(
        {
          retryPolicy: options?.promiseRetryPolicy,
        },
        async (
          ctx: restate.ObjectSharedContext<State>,
          {
            self,
            srcs,
            input,
            version,
          }: {
            self?: SerialisableActorRef;
            srcs: string[];
            input: unknown;
            version?: string;
          },
        ) => {
          await validateStateMachineIsNotDisposed(ctx);

          const systemName = ctx.key;

          if (version == undefined) {
            // most likely this invocation was created before updating to a version of the library that would provide a version
            // in this case we default to latest
            version = latestLogic.id;
          }
          const logic = getLogic(latestLogic, versions, version);

          ctx.console.log(
            "run promise with srcs",
            srcs,
            "at version",
            version,
            "in system",
            systemName,
          );

          const [promiseSrc, ...machineSrcs] = srcs;

          let stateMachine: AnyStateMachine = logic;
          for (const src of machineSrcs) {
            let maybeSM;
            try {
              maybeSM = resolveReferencedActor(stateMachine, src);
            } catch (e) {
              throw new restate.TerminalError(
                `Failed to resolve promise actor ${src}: ${String(e)}`,
              );
            }
            if (maybeSM === undefined) {
              throw new restate.TerminalError(
                `Couldn't find state machine actor with src ${src}`,
              );
            }
            if ("implementations" in maybeSM) {
              stateMachine = maybeSM as AnyStateMachine;
            } else {
              throw new restate.TerminalError(
                `Couldn't recognise machine actor with src ${src}`,
              );
            }
          }

          let promiseActor: PromiseActorLogic<unknown> | undefined;
          let maybePA;
          try {
            maybePA =
              typeof promiseSrc === "string"
                ? resolveReferencedActor(stateMachine, promiseSrc)
                : undefined;
          } catch (e) {
            throw new restate.TerminalError(
              `Failed to resolve promise actor ${String(promiseSrc)}: ${String(e)}`,
            );
          }
          if (maybePA === undefined) {
            throw new restate.TerminalError(
              `Couldn't find promise actor with src ${String(promiseSrc)}`,
            );
          }
          if (
            "sentinel" in maybePA &&
            maybePA.sentinel === "restate.promise.actor"
          ) {
            promiseActor = maybePA as PromiseActorLogic<unknown>;
          } else {
            throw new restate.TerminalError(
              `Couldn't recognise promise actor with src ${String(promiseSrc)}`,
            );
          }

          const resolvedPromise = Promise.resolve(
            (promiseActor.config as PromiseCreator<unknown, unknown>)({
              input,
              ctx: ctx as unknown as restate.ObjectSharedContext,
            }),
          );

          if (self) {
            // non-retry case, we report to state machine and return

            try {
              const response = await resolvedPromise;

              void ctx
                .objectClient<
                  ActorObjectHandlers<LatestStateMachine>
                >(api, systemName)
                .send({
                  source: self,
                  target: self,
                  event: {
                    type: RESTATE_PROMISE_RESOLVE,
                    data: response,
                  },
                });

              // nothing relies on this response, we return it for the benefit of debugging
              return response;
            } catch (e) {
              void ctx
                .objectClient<
                  ActorObjectHandlers<LatestStateMachine>
                >(api, systemName)
                .send({
                  source: self,
                  target: self,
                  event: {
                    type: RESTATE_PROMISE_REJECT,
                    data: e,
                  },
                });

              // nothing relies on this error, but its helpful to see that the promise failed
              if (e instanceof restate.TerminalError) {
                throw e;
              } else if (e instanceof Error) {
                throw new restate.TerminalError(e.message);
              } else {
                throw new restate.TerminalError(String(e));
              }
            }
          } else {
            // if self is not provided, we just need to return the error and let the caller report back
            // we cannot report as we might get killed by the retry policy

            return await resolvedPromise;
          }
        },
      ),
      cleanupState: restate.handlers.object.exclusive(
        { ingressPrivate: true },
        // eslint-disable-next-line @typescript-eslint/require-await
        async (ctx: restate.ObjectContext<State>) => {
          ctx.clearAll();
          ctx.set("disposed", true);
        },
      ),
    },
  });
}

function persistedSnapshotWithTags(
  actor: Actor<AnyActorLogic>,
  persistedSnapshot?: Snapshot<unknown>,
): SnapshotWithTags {
  const snapshot = persistedSnapshot ?? actor.getPersistedSnapshot();
  const tags = [...(actor.getSnapshot() as AnyMachineSnapshot).tags];
  tags.sort();

  return {
    ...snapshot,
    tags,
  };
}

function validateCondition(condition: string): asserts condition is Condition {
  if (condition === "done") return;
  if (condition.startsWith("hasTag:")) return;
  throw new restate.TerminalError("Invalid subscription condition", {
    errorCode: 400,
  });
}

function evaluateCondition(
  ctx: restate.ObjectContext<State>,
  actor: Actor<AnyActorLogic>,
  condition: string,
  awakeables: string[],
): boolean {
  const snapshot = actor.getSnapshot() as AnyMachineSnapshot;

  if (snapshot.status === "error") {
    awakeables.forEach((awakeable) => {
      ctx.rejectAwakeable(awakeable, `State machine returned an error`);
    });
    return true;
  }

  if (condition.startsWith("hasTag:") && snapshot.hasTag(condition.slice(7))) {
    const persistedSnapshot = persistedSnapshotWithTags(actor);
    awakeables.forEach((awakeable) => {
      ctx.resolveAwakeable(awakeable, persistedSnapshot);
    });
    return true;
  }

  if (snapshot.status === "done") {
    if (condition === "done") {
      const persistedSnapshot = persistedSnapshotWithTags(actor);
      awakeables.forEach((awakeable) => {
        ctx.resolveAwakeable(awakeable, persistedSnapshot);
      });
    } else {
      awakeables.forEach((awakeable) => {
        ctx.rejectAwakeable(
          awakeable,
          `State machine completed without the condition being met`,
        );
      });
    }

    return true;
  }

  return false;
}

class ConditionObserver implements Observer<AnyMachineSnapshot> {
  constructor(
    private readonly ctx: restate.ObjectContext<State>,
    private readonly actor: Actor<AnyActorLogic>,
    private readonly subscriptions: {
      [condition: string]: Subscription;
    },
  ) {}

  next() {
    this.evaluate();
  }

  error() {
    this.evaluate();
  }

  evaluate() {
    for (const [condition, subscription] of Object.entries(
      this.subscriptions,
    )) {
      if (
        evaluateCondition(
          this.ctx,
          this.actor,
          condition as Condition,
          subscription.awakeables,
        )
      ) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete this.subscriptions[condition];
        this.ctx.set("subscriptions", this.subscriptions);
      }
    }
  }
}
