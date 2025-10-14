import type {
  ActorSystemInfo,
  AnyEventObject,
  AnyStateMachine,
  InputFrom,
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
  WaitForRequest,
  WatchResult,
} from "./types.js";
import { ValidWatchCondition } from "./types.js";
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

async function getVersion<
  LatestVersion extends string,
  PreviousVersion extends string,
>(
  ctx: restate.ObjectSharedContext<State>,
  latestVersion: LatestVersion,
): Promise<LatestVersion | PreviousVersion> {
  let version = (await ctx.get("version")) as
    | LatestVersion
    | PreviousVersion
    | null;
  if (version == null) {
    version = latestVersion;
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

        const version = await getOrSetVersion(ctx, latestLogic.id);
        const logic = getLogic(
          latestLogic,
          versions,
          version,
        ) as LatestStateMachine;

        const root = (
          await createActor(ctx, api, systemName, version, logic, {
            input: {
              ...(request?.input ?? {}),
            } as InputFrom<LatestStateMachine>,
          })
        ).start();

        const snapshot = root.getPersistedSnapshot();
        ctx.set("snapshot", snapshot);

        await checkIfStateMachineShouldBeDisposed(
          ctx,
          api,
          systemName,
          options?.finalStateTTL,
        );

        return snapshot;
      },
      send: async (
        ctx: restate.ObjectContext<State>,
        request?: {
          scheduledEvent?: SerialisableScheduledEvent;
          source?: SerialisableActorRef;
          target?: SerialisableActorRef;
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

        const root = (
          await createActor<PreviousStateMachine | LatestStateMachine>(
            ctx,
            api,
            systemName,
            version,
            logic,
          )
        ).start();

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

        const nextSnapshot = root.getPersistedSnapshot();
        ctx.set("snapshot", nextSnapshot);

        await checkIfStateMachineShouldBeDisposed(
          ctx,
          api,
          systemName,
          options?.finalStateTTL,
        );

        return nextSnapshot;
      },
      snapshot: async (
        ctx: restate.ObjectContext<State>,
      ): Promise<Snapshot<unknown>> => {
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

        return root.getPersistedSnapshot();
      },
      invokePromise: restate.handlers.object.shared(
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

          await resolvedPromise.then(
            (response) => {
              ctx
                .objectSendClient<
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
            },
            (errorData: unknown) => {
              ctx
                .objectSendClient<
                  ActorObjectHandlers<LatestStateMachine>
                >(api, systemName)
                .send({
                  source: self,
                  target: self,
                  event: {
                    type: RESTATE_PROMISE_REJECT,
                    data: errorData,
                  },
                });
            },
          );
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
      hasTag: async (
        ctx: restate.ObjectContext<State>,
        req?: { tag: string },
      ) => {
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

        await validateStateMachineIsNotDisposed(ctx);

        const liveState = root.getSnapshot();
        const tag = req?.tag;

        return "hasTag" in liveState && (liveState as any).hasTag(tag);
      },
      waitFor: restate.handlers.object.shared(
        async (
          ctx: restate.ObjectSharedContext<State>,
          req: WaitForRequest,
        ): Promise<WatchResult> => {
          await validateStateMachineIsNotDisposed(ctx);
          const systemName = ctx.key;
          const version = await getVersion(ctx, latestLogic.id);
          const start = Date.now();

          if (
            !req.condition ||
            !Object.values(ValidWatchCondition).includes(req.condition)
          ) {
            throw new restate.TerminalError(
              "Invalid request: 'condition' must be one of ValidWatchCondition values",
            );
          }
          if (req.condition === "result" && !req.resultKey) {
            throw new restate.TerminalError(
              "Invalid request: 'resultKey' must be provided when 'condition' is 'result'",
            );
          }
          if (
            (req.condition === "tagObserved" || req.condition === "tagCleared") &&
            !req.observeTag
          ) {
            throw new restate.TerminalError(
              "Invalid request: 'tag' must be provided when 'condition' is 'tagObserved' or 'tagCleared'",
            );
          }

          ctx.console.log(
            `Waiting for condition ${req.condition} with tag ${req.observeTag} or resultKey ${req.resultKey} in objectId ${systemName}`,
          );

          const until = req.condition;
          const tag = req.observeTag as string;
          const awaitResultKey = req.resultKey;
          const intervalMs = req.intervalMs || 1000;
          const timeoutMs = req.timeoutMs || 60000;

          const selfClient = ctx.objectClient<
            ActorObjectHandlers<AnyStateMachine>
          >(api, systemName);
          if (!selfClient) {
            throw new restate.TerminalError(
              `Actor object ${systemName} not found`,
            );
          }

          const machineCurrentStatus = async () => {
            // Get the current state of the machine
            const hasTag = await selfClient.hasTag({ tag });
            const snapshot = await selfClient.snapshot() as any;
            const isFinal = snapshot.status === 'done';
            let awaitResultValue;
            if (awaitResultKey && snapshot && "context" in snapshot) {
              awaitResultValue = snapshot.context[awaitResultKey];
            }

            return {
              isFinal,
              hasTag,
              snapshot,
              awaitResultValue,
            };
          };

          // Check if tag exists in machine definition (for tagObserved and tagCleared)
          if ((until === "tagObserved" || until === "tagCleared") && tag) {
            const logic = getLogic(latestLogic, versions, version);
            let tagExists = false;
            
            // Check if the tag is defined in any state
            if (logic.config && logic.config.states) {
              // Recursively check states for tags
              const checkStateForTag = (states: Record<string, any>) => {
                for (const stateName in states) {
                  const state = states[stateName];
                  // Check if this state has the tag
                  if (state.tags && state.tags.includes(tag)) {
                    return true;
                  }
                  // Check nested states
                  if (state.states && checkStateForTag(state.states)) {
                    return true;
                  }
                }
                return false;
              };
              
              tagExists = checkStateForTag(logic.config.states);
            }
            
            if (!tagExists) {
              return {
                timedOut: false,
                waitedMs: Date.now() - start,
                error:  new Error(`Tag "${tag}" is not defined in any state of the machine ${systemName}`),
              };
            }
          }

          // Track if we've seen the tag before
          let tagWasObserved = false;

          while (true) {
            if (Date.now() - start > timeoutMs) {
              return { 
                timedOut: true, 
                waitedMs: Date.now() - start,
                error: new Error(`Timeout after ${timeoutMs}ms waiting for ${until} condition on machine ${systemName}`),
              };
            }
            const { isFinal, hasTag, snapshot, awaitResultValue } =
              await machineCurrentStatus();
            
            // Update tag observation state
            if (hasTag) {
              tagWasObserved = true;
            }
            
            if (until === "final" && isFinal) {
              return {
                timedOut: false,
                waitedMs: Date.now() - start,
                result: snapshot,
              };
            }
            if (until === "tagObserved" && hasTag) {
              return {
                timedOut: false,
                waitedMs: Date.now() - start,
                result: awaitResultKey ? awaitResultValue : snapshot,
              };
            }
            if (until === "tagCleared" && !hasTag && tagWasObserved) {
              return {
                timedOut: false,
                waitedMs: Date.now() - start,
                result: awaitResultKey ? awaitResultValue : snapshot,
              };
            }
            if (until === "result" && awaitResultValue) {
              return {
                timedOut: false,
                waitedMs: Date.now() - start,
                result:
                  awaitResultKey && awaitResultValue
                    ? awaitResultValue
                    : snapshot,
              };
            }
            ctx.console.log(
              `Condition ${until} not met yet, waiting for ${intervalMs}ms...`,
            );
            await ctx.sleep(intervalMs);
          }
        },
      ),
    },
  });
}
