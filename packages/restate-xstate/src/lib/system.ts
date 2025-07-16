import type {
  ActorSystem,
  ActorSystemInfo,
  AnyActorRef,
  AnyEventObject,
  AnyStateMachine,
  EventObject,
  HomomorphicOmit,
  InspectionEvent,
  Observer,
} from "xstate";
import * as restate from "@restatedev/restate-sdk";
import type {
  ActorRefEventSender,
  SerialisableActorRef,
  State,
  SerialisableScheduledEvent,
  XStateApi,
  ActorObjectHandlers,
} from "./types.js";
import { serialiseActorRef } from "./utils.js";

export interface RestateActorSystem<T extends ActorSystemInfo>
  extends ActorSystem<T> {
  _bookId: () => string;
  _register: (sessionId: string, actorRef: ActorRefEventSender) => string;
  _unregister: (actorRef: AnyActorRef) => void;
  _sendInspectionEvent: (
    event: HomomorphicOmit<InspectionEvent, "rootId">,
  ) => void;
  actor: (sessionId: string) => ActorRefEventSender | undefined;
  _set: <K extends keyof T["actors"]>(key: K, actorRef: T["actors"][K]) => void;
  _relay: (
    source: AnyActorRef | SerialisableActorRef | undefined,
    target: ActorRefEventSender,
    event: AnyEventObject,
  ) => void;
  api: XStateApi<string, AnyStateMachine>;
  ctx: restate.ObjectContext<State>;
  systemName: string;
  version: string;
}

export function createScheduledEventId(
  actorRef: SerialisableActorRef,
  id: string,
): string {
  return `${actorRef.sessionId}.${id}`;
}

export async function createSystem<T extends ActorSystemInfo>(
  ctx: restate.ObjectContext<State>,
  api: XStateApi<string, AnyStateMachine>,
  systemName: string,
  version: string,
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
      id: string | undefined,
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
        delay,
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
          target.id,
        );
        return;
      }

      events[scheduledEventId] = scheduledEvent;
      ctx
        .objectSendClient<
          ActorObjectHandlers<AnyStateMachine>
        >(api, systemName, { delay })
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
        id,
      );

      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete events[scheduledEventId];
      ctx.set("events", events);
    },
    cancelAll(actorRef: AnyActorRef): void {
      if (Object.keys(events).length == 0) return;

      ctx.console.log("Cancel all events for", actorRef.id);

      for (const scheduledEventId in events) {
        const scheduledEvent = events[scheduledEventId];
        if (scheduledEvent?.source.sessionId === actorRef.sessionId) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
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
      const existingSessionId = childrenByID[actorRef.id]?.sessionId;

      if (existingSessionId) {
        // rehydration case; ensure session ID maintains continuity
        sessionId = existingSessionId;
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
      const sessionId = childrenByID[actorRef.id]?.sessionId;
      if (sessionId) {
        // rehydration case; ensure session ID maintains continuity
        actorRef.sessionId = sessionId;
      }

      children.delete(actorRef.sessionId);
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
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
          `Actor with system ID '${systemId as string}' already exists.`,
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
        event.type,
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
    _logger: (...args: unknown[]) => {
      ctx.console.log(...args);
    },
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
