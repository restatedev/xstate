import type {
  ObjectContext,
  ObjectSharedContext,
  VirtualObjectDefinition,
} from "@restatedev/restate-sdk";
import type {
  Actor,
  AnyActorLogic,
  AnyActorRef,
  AnyEventObject,
  AnyStateMachine,
  EventObject,
  InputFrom,
  NonReducibleUnknown,
  Snapshot,
} from "xstate";

export type SerialisableActorRef = {
  id: string;
  sessionId: string;
  _parent?: SerialisableActorRef;
};

export type PromiseCreator<TOutput, TInput extends NonReducibleUnknown> = ({
  input,
  ctx,
}: {
  input: TInput;
  ctx: ObjectSharedContext;
}) => PromiseLike<TOutput>;

export type SerialisableScheduledEvent = {
  id: string;
  event: EventObject;
  startedAt: number;
  delay: number;
  source: SerialisableActorRef;
  target: SerialisableActorRef;
  uuid: string;
};

export type State = {
  version: string;
  events: { [key: string]: SerialisableScheduledEvent };
  children: { [key: string]: SerialisableActorRef };
  snapshot: Snapshot<unknown>;
  /** Indicates whether a state machine has been disposed/cleaned after reaching it's final state */
  disposed: boolean;
};

export interface ActorEventSender<TLogic extends AnyActorLogic>
  extends Actor<TLogic> {
  _send: (event: AnyEventObject) => void;
}

export interface ActorRefEventSender extends AnyActorRef {
  _send: (event: AnyEventObject) => void;
}

export interface XStateOptions<PreviousStateMachine extends AnyStateMachine> {
  versions?: PreviousStateMachine[];
  /**
   * Represent time to live (in ms) of a state machine after it has reached a final state.
   * @default Infinity
   * */
  finalStateTTL?: number;
}

export type ActorObjectHandlers<LatestStateMachine extends AnyStateMachine> = {
  create: (
    ctx: ObjectContext<State>,
    request?: {
      input?: InputFrom<LatestStateMachine>;
    },
  ) => Promise<Snapshot<unknown>>;
  send: (
    ctx: ObjectContext<State>,
    request?: {
      scheduledEvent?: SerialisableScheduledEvent;
      source?: SerialisableActorRef;
      target?: SerialisableActorRef;
      event: AnyEventObject;
    },
  ) => Promise<Snapshot<unknown> | undefined>;
  snapshot: (ctx: ObjectContext<State>) => Promise<Snapshot<unknown>>;
  cleanupState: (ctx: ObjectContext<State>) => Promise<void>;
  invokePromise: (
    ctx: ObjectSharedContext<State>,
    input: {
      self: SerialisableActorRef;
      srcs: string[];
      input: unknown;
      version?: string;
    },
  ) => Promise<void>;
};

export type ActorObject<
  P extends string,
  LatestStateMachine extends AnyStateMachine,
  PreviousStateMachine extends AnyStateMachine,
> = (
  path: P,
  latestLogic: LatestStateMachine,
  options?: XStateOptions<PreviousStateMachine>,
) => VirtualObjectDefinition<P, ActorObjectHandlers<LatestStateMachine>>;

export type XStateApi<
  P extends string,
  LatestStateMachine extends AnyStateMachine,
> = ReturnType<ActorObject<P, LatestStateMachine, AnyStateMachine>>;
