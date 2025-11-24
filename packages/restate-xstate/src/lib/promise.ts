import type {
  ActorLogic,
  ActorRefFrom,
  ActorSystem,
  ActorSystemInfo,
  AnyActorRef,
  AnyStateMachine,
  NonReducibleUnknown,
  Snapshot,
} from "xstate";
import {
  RESTATE_PROMISE_REJECT,
  RESTATE_PROMISE_RESOLVE,
} from "./constants.js";
import { serialiseActorRef } from "./utils.js";
import type {
  ActorObjectHandlers,
  ActorRefEventSender,
  PromiseCreator,
} from "./types.js";
import type { RestateActorSystem } from "./system.js";

export type PromiseSnapshot<TOutput, TInput> = Snapshot<TOutput> & {
  input: TInput | undefined;
  sent: boolean;
};

const RESTATE_PROMISE_SENT = "restate.promise.sent";

const XSTATE_STOP = "xstate.stop";

export type PromiseActorLogic<TOutput, TInput = unknown> = ActorLogic<
  PromiseSnapshot<TOutput, TInput>,
  { type: string; [k: string]: unknown },
  TInput, // input
  ActorSystem<ActorSystemInfo>
> & {
  sentinel: "restate.promise.actor";
  config: PromiseCreator<TOutput, TInput>;
};

export type PromiseActorRef<TOutput> = ActorRefFrom<PromiseActorLogic<TOutput>>;
export type FromPromise<TOutput, TInput extends NonReducibleUnknown> = (
  promiseCreator: PromiseCreator<TOutput, TInput>,
) => PromiseActorLogic<TOutput, TInput>;

export type FromPromiseOpts = {
  // Use Restate's builtin retry functionality to retry this promise.
  // Non-retryable errors can be thrown with `new restate.TerminalError(...)`.
  // The retry policy for the invokePromise handler can be configured in `XStateOptions`.
  retry?: boolean;
};

export function fromPromise<TOutput, TInput extends NonReducibleUnknown>(
  promiseCreator: PromiseCreator<TOutput, TInput>,
  opts?: FromPromiseOpts,
): ReturnType<FromPromise<TOutput, TInput>> {
  const logic: PromiseActorLogic<TOutput, TInput> = {
    sentinel: "restate.promise.actor",
    config: promiseCreator,
    transition: (state, event) => {
      if (state.status !== "active") {
        return state;
      }

      switch (event.type) {
        case RESTATE_PROMISE_SENT: {
          return {
            ...state,
            sent: true,
          };
        }
        case RESTATE_PROMISE_RESOLVE: {
          const resolvedValue = (event as unknown as { data: TOutput }).data;
          return {
            ...state,
            status: "done",
            output: resolvedValue,
            input: undefined,
          };
        }
        case RESTATE_PROMISE_REJECT:
          return {
            ...state,
            status: "error",
            error: (event as unknown as { data: unknown }).data,
            input: undefined,
          };
        case XSTATE_STOP:
          return {
            ...state,
            status: "stopped",
            input: undefined,
          };
        default:
          return state;
      }
    },
    start: (state, { self, system }) => {
      if (state.status !== "active") {
        return;
      }

      if (state.sent) {
        return;
      }

      const rs = system as RestateActorSystem<ActorSystemInfo>;

      if (opts?.retry) {
        void rs.ctx
          .objectClient<
            ActorObjectHandlers<AnyStateMachine>
          >(rs.api, rs.systemName)
          .invokePromiseRetry({
            self: serialiseActorRef(self),
            srcs: actorSrc(self),
            input: state.input,
            version: rs.version,
          });
      } else {
        void rs.ctx
          .objectClient<
            ActorObjectHandlers<AnyStateMachine>
          >(rs.api, rs.systemName)
          .invokePromise({
            self: serialiseActorRef(self),
            srcs: actorSrc(self),
            input: state.input,
            version: rs.version,
          });
      }

      // note that we sent off the promise so we don't do it again
      rs._relay(self, self as ActorRefEventSender, {
        type: RESTATE_PROMISE_SENT,
      });
    },
    getInitialSnapshot: (_, input) => {
      return {
        status: "active",
        output: undefined,
        error: undefined,
        input,
        sent: false,
      };
    },
    getPersistedSnapshot: (snapshot) => snapshot,
    restoreSnapshot: (snapshot: Snapshot<unknown>) =>
      snapshot as PromiseSnapshot<TOutput, TInput>,
  };

  return logic;
}

export function fromPromiseWithRetry<
  TOutput,
  TInput extends NonReducibleUnknown,
>(
  promiseCreator: PromiseCreator<TOutput, TInput>,
  opts?: FromPromiseOpts,
): ReturnType<FromPromise<TOutput, TInput>> {
  return fromPromise(promiseCreator, {
    ...opts,
    retry: opts?.retry ?? true,
  });
}

function actorSrc(actor?: AnyActorRef): string[] {
  if (actor === undefined) {
    return [];
  }
  if (typeof actor.src !== "string") {
    return [];
  }
  return [actor.src, ...actorSrc(actor._parent)];
}
