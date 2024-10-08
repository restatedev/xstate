import type {
  Actor,
  ActorLogicFrom,
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
  api: XStateApi<ActorLogicFrom<T>>;
  ctx: restate.ObjectContext<State>;
  systemName: string;
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
  events: { [key: string]: SerialisableScheduledEvent };
  children: { [key: string]: SerialisableActorRef };
  snapshot: Snapshot<unknown>;
};

async function createSystem<T extends ActorSystemInfo>(
  ctx: restate.ObjectContext<State>,
  api: XStateApi<ActorLogicFrom<T>>,
  systemName: string
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
  api: XStateApi<TLogic>,
  systemName: string,
  logic: TLogic,
  options?: ActorOptions<TLogic>
): Promise<ActorEventSender<TLogic>> {
  const system = await createSystem(ctx, api, systemName);
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

const actorObject = <TLogic extends AnyStateMachine>(
  path: string,
  logic: TLogic
) => {
  const api = xStateApi(path);

  return restate.object({
    name: path,
    handlers: {
      create: async (
        ctx: restate.ObjectContext<State>,
        request?: { input?: InputFrom<TLogic> }
      ): Promise<Snapshot<unknown>> => {
        const systemName = ctx.key;

        ctx.clear("snapshot");
        ctx.clear("events");
        ctx.clear("children");

        const root = (
          await createActor(ctx, api, systemName, logic, {
            input: {
              ctx,
              key: ctx.key,
              ...(request?.input ?? {}),
            } as InputFrom<TLogic>,
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

        const root = (await createActor(ctx, api, systemName, logic)).start();

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
        ctx: restate.ObjectContext<State>,
        systemName: string
      ): Promise<Snapshot<unknown>> => {
        const root = await createActor(ctx, api, systemName, logic);

        return root.getPersistedSnapshot();
      },
      invokePromise: restate.handlers.object.shared(
        async (
          ctx: restate.ObjectSharedContext,
          {
            self,
            srcs,
            input,
          }: {
            self: SerialisableActorRef;
            srcs: string[];
            input: unknown;
          }
        ) => {
          const systemName = ctx.key;

          ctx.console.log(
            "run promise with srcs",
            srcs,
            "in system",
            systemName,
            "with input",
            input
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
              ctx,
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

export const xstate = <TLogic extends AnyStateMachine>(
  path: string,
  logic: TLogic
) => {
  return actorObject(path, logic);
};

export const xStateApi = <TLogic extends AnyStateMachine>(
  path: string
): XStateApi<TLogic> => {
  return { name: path };
};

type XStateApi<TLogic extends AnyStateMachine> = ReturnType<
  typeof actorObject<TLogic>
>;

function createScheduledEventId(
  actorRef: SerialisableActorRef,
  id: string
): string {
  return `${actorRef.sessionId}.${id}`;
}
