import type {
  Actor,
  ActorOptions,
  ActorSystem,
  ActorSystemInfo,
  AnyActorLogic,
  AnyActorRef,
  AnyEventObject,
  AnyStateMachine,
  EventObject,
  HomomorphicOmit,
  InputFrom,
  InspectionEvent,
  InteropSubscribable,
  Observer,
  PromiseActorLogic,
  Snapshot,
  Subscription,
} from "xstate";
import { toObserver, createActor as createXActor } from "xstate";
import * as restate from "@restatedev/restate-sdk";
import { TerminalError } from "@restatedev/restate-sdk";
import {
  type PromiseCreator,
  resolveReferencedActor,
  RESTATE_PROMISE_REJECT,
  RESTATE_PROMISE_RESOLVE,
} from "./promise.js";

export interface RestateActorSystem<T extends ActorSystemInfo>
  extends ActorSystem<T> {
  _bookId: () => string;
  _register: (sessionId: string, actorRef: ActorRefEventSender) => string;
  _unregister: (actorRef: AnyActorRef) => void;
  _sendInspectionEvent: (
    event: HomomorphicOmit<InspectionEvent, "rootId">
  ) => void;
  actor: (sessionId: string) => ActorRefEventSender | undefined;
  _set: <K extends keyof T["actors"]>(key: K, actorRef: T["actors"][K]) => void;
  _relay: (
    source: AnyActorRef | SerialisableActorRef | undefined,
    target: ActorRefEventSender,
    event: AnyEventObject
  ) => void;
  api: XStateApi<string, AnyStateMachine>;
  ctx: restate.ObjectContext<State>;
  systemName: string;
  version: string;
}

type SerialisableActorRef = {
  id: string;
  sessionId: string;
  _parent?: SerialisableActorRef;
};

export const serialiseActorRef = (
  actorRef: AnyActorRef
): SerialisableActorRef => {
  return {
    id: actorRef.id,
    sessionId: actorRef.sessionId,
    _parent:
      actorRef._parent === undefined
        ? undefined
        : serialiseActorRef(actorRef._parent),
  };
};

type SerialisableScheduledEvent = {
  id: string;
  event: EventObject;
  startedAt: number;
  delay: number;
  source: SerialisableActorRef;
  target: SerialisableActorRef;
  uuid: string;
};

type State = {
  version: string;
  events: { [key: string]: SerialisableScheduledEvent };
  children: { [key: string]: SerialisableActorRef };
  snapshot: Snapshot<unknown>;
};

async function createSystem<T extends ActorSystemInfo>(
  ctx: restate.ObjectContext<State>,
  api: XStateApi<string, AnyStateMachine>,
  systemName: string,
  version: string
): Promise<RestateActorSystem<T>> {
  const events = (await ctx.get("events")) ?? {};
  const childrenByID = (await ctx.get("children")) ?? {};

  const children = new Map<string, ActorRefEventSender>();
  const keyedActors = new Map<keyof T["actors"], AnyActorRef | undefined>();
  const reverseKeyedActors = new WeakMap<AnyActorRef, keyof T["actors"]>();
  const observers = new Set<
    Observer<InspectionEvent> | ((inspectionEvent: InspectionEvent) => void)
  >();

  const scheduler = {
    schedule(
      _source: AnyActorRef,
      _target: AnyActorRef,
      event: EventObject,
      delay: number,
      id: string | undefined
    ): void {
      if (id === undefined) {
        id = ctx.rand.random().toString(36).slice(2);
      }

      const { source, target } = {
        source: serialiseActorRef(_source),
        target: serialiseActorRef(_target),
      };

      ctx.console.log(
        "Scheduling event from",
        source.id,
        "to",
        target.id,
        "with id",
        id,
        "and delay",
        delay
      );

      const scheduledEvent: SerialisableScheduledEvent = {
        source,
        target,
        event,
        delay,
        id,
        startedAt: Date.now(),
        uuid: ctx.rand.uuidv4(),
      };
      const scheduledEventId = createScheduledEventId(source, id);
      if (scheduledEventId in events) {
        ctx.console.log(
          "Ignoring duplicate schedule from",
          source.id,
          "to",
          target.id
        );
        return;
      }

      events[scheduledEventId] = scheduledEvent;

      ctx
        .objectSendClient(api, systemName, { delay })
        .send({ scheduledEvent, source, target, event });
      ctx.set("events", events);
    },
    cancel(source: AnyActorRef, id: string): void {
      const scheduledEventId = createScheduledEventId(source, id);

      if (!(scheduledEventId in events)) return;

      ctx.console.log(
        "Cancelling scheduled event from",
        source.id,
        "with id",
        id
      );

      delete events[scheduledEventId];
      ctx.set("events", events);
    },
    cancelAll(actorRef: AnyActorRef): void {
      if (Object.keys(events).length == 0) return;

      ctx.console.log("Cancel all events for", actorRef.id);

      for (const scheduledEventId in events) {
        const scheduledEvent = events[scheduledEventId];
        if (scheduledEvent.source.sessionId === actorRef.sessionId) {
          delete events[scheduledEventId];
        }
      }
      ctx.set("events", events);
    },
  };

  const system: RestateActorSystem<T> = {
    ctx,
    api,
    systemName,
    version,

    _bookId: () => ctx.rand.uuidv4(),
    _register: (sessionId, actorRef) => {
      if (actorRef.id in childrenByID) {
        // rehydration case; ensure session ID maintains continuity
        sessionId = childrenByID[actorRef.id].sessionId;
        actorRef.sessionId = sessionId;
      } else {
        // new actor case
        childrenByID[actorRef.id] = serialiseActorRef(actorRef);
        ctx.set("children", childrenByID);
      }
      children.set(sessionId, actorRef);
      return sessionId;
    },
    _unregister: (actorRef) => {
      if (actorRef.id in childrenByID) {
        // rehydration case; ensure session ID maintains continuity
        actorRef.sessionId = childrenByID[actorRef.id].sessionId;
      }

      children.delete(actorRef.sessionId);
      delete childrenByID[actorRef.id];
      ctx.set("children", childrenByID);
      const systemId = reverseKeyedActors.get(actorRef);

      if (systemId !== undefined) {
        keyedActors.delete(systemId);
        reverseKeyedActors.delete(actorRef);
      }
    },
    _sendInspectionEvent: (event) => {
      const resolvedInspectionEvent: InspectionEvent = {
        ...event,
        rootId: ctx.key,
      };
      observers.forEach((observer) => {
        if (typeof observer == "function") {
          observer(resolvedInspectionEvent);
        } else {
          observer.next?.(resolvedInspectionEvent);
        }
      });
    },
    actor: (sessionId) => {
      return children.get(sessionId);
    },
    get: (systemId) => {
      return keyedActors.get(systemId) as T["actors"][typeof systemId];
    },
    _set: (systemId, actorRef) => {
      const existing = keyedActors.get(systemId);
      if (existing && existing !== actorRef) {
        throw new Error(
          `Actor with system ID '${systemId as string}' already exists.`
        );
      }

      keyedActors.set(systemId, actorRef);
      reverseKeyedActors.set(actorRef, systemId);
    },
    inspect: (observer) => {
      observers.add(observer);
      return {
        unsubscribe: () => {
          observers.delete(observer);
        },
      };
    },
    _relay: (source, target, event) => {
      ctx.console.log(
        "Relaying message from",
        source?.id,
        "to",
        target.id,
        ":",
        event.type
      );
      target._send(event);
    },
    scheduler,
    getSnapshot: () => {
      return {
        _scheduledEvents: {}, // unused
      };
    },
    start: () => {},
    _logger: (...args: unknown[]) => ctx.console.log(...args),
    _clock: {
      setTimeout() {
        throw new Error("clock should be unused");
      },
      clearTimeout() {
        throw new Error("clock should be unused");
      },
    },
  };

  return system;
}

interface ActorEventSender<TLogic extends AnyActorLogic> extends Actor<TLogic> {
  _send: (event: AnyEventObject) => void;
}

export interface ActorRefEventSender extends AnyActorRef {
  _send: (event: AnyEventObject) => void;
}

async function createActor<TLogic extends AnyStateMachine>(
  ctx: restate.ObjectContext<State>,
  api: XStateApi<string, TLogic>,
  systemName: string,
  version: string,
  logic: TLogic,
  options?: ActorOptions<TLogic>
): Promise<ActorEventSender<TLogic>> {
  const system = await createSystem(ctx, api, systemName, version);
  const snapshot = (await ctx.get("snapshot")) ?? undefined;

  const parent: ActorRefEventSender = {
    id: "fakeRoot",
    sessionId: "fakeRoot",
    send: () => {},
    _send: () => {},
    start: () => {},
    getSnapshot: (): null => {
      return null;
    }, // TODO
    getPersistedSnapshot: (): Snapshot<unknown> => {
      return {
        status: "active",
        output: undefined,
        error: undefined,
      };
    }, // TODO
    stop: () => {}, // TODO
    on: () => {
      return { unsubscribe: () => {} };
    }, // TODO
    system,
    src: "fakeRoot",
    subscribe: (): Subscription => {
      return {
        unsubscribe() {},
      };
    },
    [Symbol.observable]: (): InteropSubscribable<unknown> => {
      return {
        subscribe(): Subscription {
          return {
            unsubscribe() {},
          };
        },
      };
    },
  };

  if (options?.inspect) {
    // Always inspect at the system-level
    system.inspect(toObserver(options.inspect));
  }

  const actor = createXActor(logic, {
    id: ctx.key,
    ...options,
    parent,
    snapshot,
  });

  return actor as ActorEventSender<TLogic>;
}

const actorObject = <
  P extends string,
  LatestStateMachine extends AnyStateMachine,
  PreviousStateMachine extends AnyStateMachine
>(
  path: P,
  latestLogic: LatestStateMachine,
  options?: XStateOptions<PreviousStateMachine>
) => {
  const api: XStateApi<string, LatestStateMachine> = { name: path };

  const versions = options?.versions ?? [];

  return restate.object({
    name: path,
    handlers: {
      create: async (
        ctx: restate.ObjectContext<State>,
        request?: {
          input?: InputFrom<LatestStateMachine>;
        }
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
          version
        ) as LatestStateMachine;

        const root = (
          await createActor(ctx, api, systemName, version, logic, {
            input: {
              ctx,
              key: ctx.key,
              ...(request?.input ?? {}),
            } as InputFrom<LatestStateMachine>,
          })
        ).start();

        ctx.set("snapshot", root.getPersistedSnapshot());

        return root.getPersistedSnapshot();
      },
      send: async (
        ctx: restate.ObjectContext<State>,
        request?: {
          scheduledEvent?: SerialisableScheduledEvent;
          source?: SerialisableActorRef;
          target?: SerialisableActorRef;
          event: AnyEventObject;
        }
      ): Promise<Snapshot<unknown> | undefined> => {
        const systemName = ctx.key;

        if (!request) {
          throw new TerminalError("Must provide a request");
        }

        const version = await getOrSetVersion(ctx, latestLogic.id);
        const logic = getLogic(latestLogic, versions, version);

        if (request.scheduledEvent) {
          const events = (await ctx.get("events")) ?? {};
          const scheduledEventId = createScheduledEventId(
            request.scheduledEvent.source,
            request.scheduledEvent.id
          );
          if (!(scheduledEventId in events)) {
            ctx.console.log(
              "Received now cancelled event",
              scheduledEventId,
              "for target",
              request.target
            );
            return;
          }
          if (events[scheduledEventId].uuid !== request.scheduledEvent.uuid) {
            ctx.console.log(
              "Received now replaced event",
              scheduledEventId,
              "for target",
              request.target
            );
            return;
          }
          delete events[scheduledEventId];
          ctx.set("events", events);
        }

        const root = (
          await createActor<PreviousStateMachine | LatestStateMachine>(
            ctx,
            api,
            systemName,
            version,
            logic
          )
        ).start();

        let actor;
        if (request.target) {
          actor = (root.system as RestateActorSystem<ActorSystemInfo>).actor(
            request.target.sessionId
          );
          if (!actor) {
            throw new TerminalError(
              `Actor ${request.target.id} not found; it may have since stopped`
            );
          }
        } else {
          actor = root;
        }

        (root.system as RestateActorSystem<ActorSystemInfo>)._relay(
          request.source,
          actor,
          request.event
        );

        const nextSnapshot = root.getPersistedSnapshot();
        ctx.set("snapshot", nextSnapshot);

        return nextSnapshot;
      },
      snapshot: async (
        ctx: restate.ObjectContext<State>
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
          }
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
            systemName
          );

          const [promiseSrc, ...machineSrcs] = srcs;

          let stateMachine: AnyStateMachine = logic;
          for (const src of machineSrcs) {
            let maybeSM;
            try {
              maybeSM = resolveReferencedActor(stateMachine, src);
            } catch (e) {
              throw new TerminalError(
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                `Failed to resolve promise actor ${src}: ${e}`
              );
            }
            if (maybeSM === undefined) {
              throw new TerminalError(
                `Couldn't find state machine actor with src ${src}`
              );
            }
            if ("implementations" in maybeSM) {
              stateMachine = maybeSM as AnyStateMachine;
            } else {
              throw new TerminalError(
                `Couldn't recognise machine actor with src ${src}`
              );
            }
          }

          let promiseActor: PromiseActorLogic<unknown> | undefined;
          let maybePA;
          try {
            maybePA = resolveReferencedActor(stateMachine, promiseSrc);
          } catch (e) {
            throw new TerminalError(
              // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
              `Failed to resolve promise actor ${promiseSrc}: ${e}`
            );
          }
          if (maybePA === undefined) {
            throw new TerminalError(
              `Couldn't find promise actor with src ${promiseSrc}`
            );
          }
          if (
            "sentinel" in maybePA &&
            maybePA.sentinel === "restate.promise.actor"
          ) {
            promiseActor = maybePA as PromiseActorLogic<unknown>;
          } else {
            throw new TerminalError(
              `Couldn't recognise promise actor with src ${promiseSrc}`
            );
          }

          const resolvedPromise = Promise.resolve(
            (promiseActor.config as PromiseCreator<unknown, unknown>)({
              input,
              ctx: ctx as unknown as restate.ObjectSharedContext,
            })
          );

          await resolvedPromise.then(
            (response) => {
              ctx.objectSendClient(api, systemName).send({
                source: self,
                target: self,
                event: {
                  type: RESTATE_PROMISE_RESOLVE,
                  data: response,
                },
              });
            },
            (errorData: unknown) => {
              ctx.objectSendClient(api, systemName).send({
                source: self,
                target: self,
                event: {
                  type: RESTATE_PROMISE_REJECT,
                  data: errorData,
                },
              });
            }
          );
        }
      ),
    },
  });
};

async function getOrSetVersion<
  LatestVersion extends string,
  PreviousVersion extends string
>(
  ctx: restate.ObjectContext<State>,
  latestVersion: LatestVersion
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
  PreviousStateMachine extends AnyStateMachine
>(
  latestLogic: LatestStateMachine,
  previousVersions: PreviousStateMachine[],
  version: string
): LatestStateMachine | PreviousStateMachine {
  if (latestLogic.id === version) return latestLogic;
  const i = previousVersions.findIndex((v) => v.id === version);
  if (i !== -1) return previousVersions[i];
  throw new restate.TerminalError(
    `The state refers to a version ${version} which is not present in the code`
  );
}

export interface XStateOptions<PreviousStateMachine extends AnyStateMachine> {
  versions?: PreviousStateMachine[];
}

export const xstate = <
  P extends string,
  LatestStateMachine extends AnyStateMachine,
  PreviousStateMachine extends AnyStateMachine = never
>(
  path: P,
  logic: LatestStateMachine,
  options?: XStateOptions<PreviousStateMachine>
): XStateApi<P, LatestStateMachine> => {
  if (options?.versions) {
    const idsSet = new Set<string>();
    for (const version of options.versions) {
      if (version.id == logic.id)
        throw new Error(
          `State machine ID ${version.id} is used in both the latest and a previous version; IDs must be unique across versions`
        );
      if (idsSet.has(version.id))
        throw new Error(
          `State machine ID ${version.id} is used in two previous versions; IDs must be unique across versions`
        );
      idsSet.add(version.id);
    }
  }

  return actorObject(path, logic, options);
};

type XStateApi<
  P extends string,
  LatestStateMachine extends AnyStateMachine
> = ReturnType<typeof actorObject<P, LatestStateMachine, AnyStateMachine>>;

function createScheduledEventId(
  actorRef: SerialisableActorRef,
  id: string
): string {
  return `${actorRef.sessionId}.${id}`;
}
