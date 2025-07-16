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
} from "./types.js";
import { resolveReferencedActor } from "./utils.js";
import { createActor } from "./createActor.js";
import { createScheduledEventId, type RestateActorSystem } from "./system.js";

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

        return nextSnapshot;
      },
      snapshot: async (
        ctx: restate.ObjectContext<State>,
      ): Promise<Snapshot<unknown>> => {
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
    },
  });
}
