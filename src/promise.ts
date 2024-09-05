import type {
  ActorLogic,
  ActorRefFrom,
  ActorSystem,
  ActorSystemInfo,
  AnyActorLogic,
  AnyActorRef,
  AnyInvokeConfig,
  AnyStateMachine,
  NonReducibleUnknown,
  Snapshot,
} from "xstate";
import {
  serialiseActorRef,
  type ActorRefEventSender,
  type RestateActorSystem,
} from "./lib.js";
import type { ObjectSharedContext } from "@restatedev/restate-sdk";

export type PromiseSnapshot<TOutput, TInput> = Snapshot<TOutput> & {
  input: TInput | undefined;
  sent: boolean;
};

const RESTATE_PROMISE_SENT = "restate.promise.sent";
export const RESTATE_PROMISE_RESOLVE = "restate.promise.resolve";
export const RESTATE_PROMISE_REJECT = "restate.promise.reject";
const XSTATE_STOP = "xstate.stop";

export type PromiseCreator<TOutput, TInput extends NonReducibleUnknown> = ({
  input,
  ctx,
}: {
  input: TInput;
  ctx: ObjectSharedContext;
}) => PromiseLike<TOutput>;

export type PromiseActorLogic<TOutput, TInput = unknown> = ActorLogic<
  PromiseSnapshot<TOutput, TInput>,
  { type: string; [k: string]: unknown },
  TInput, // input
  ActorSystem<ActorSystemInfo>
> & {
  sentinel: "restate.promise.actor";
  config: PromiseCreator<TOutput, TInput>;
};

export type PromiseActorRef<TOutput> = ActorRefFrom<
  PromiseActorLogic<TOutput, unknown>
>;

export function fromPromise<TOutput, TInput extends NonReducibleUnknown>(
  promiseCreator: PromiseCreator<TOutput, TInput>
): PromiseActorLogic<TOutput, TInput> {
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

      rs.ctx.objectSendClient(rs.api, rs.systemName).invokePromise({
        self: serialiseActorRef(self),
        srcs: actorSrc(self),
        input: state.input,
      });

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

function actorSrc(actor?: AnyActorRef): string[] {
  if (actor === undefined) {
    return [];
  }
  if (typeof actor.src !== "string") {
    return [];
  }
  return [actor.src, ...actorSrc(actor._parent)];
}

export function resolveReferencedActor(
  machine: AnyStateMachine,
  src: string
): AnyActorLogic | undefined {
  const match = src.match(/^xstate\.invoke\.(\d+)\.(.*)/)!;
  if (!match) {
    return machine.implementations.actors[src] as AnyActorLogic;
  }
  const [, indexStr, nodeId] = match;
  const node = machine.getStateNodeById(nodeId);
  const invokeConfig = node.config.invoke!;
  return (
    Array.isArray(invokeConfig)
      ? (invokeConfig[Number(indexStr)] as AnyInvokeConfig)
      : (invokeConfig as AnyInvokeConfig)
  )?.src as AnyActorLogic;
}
