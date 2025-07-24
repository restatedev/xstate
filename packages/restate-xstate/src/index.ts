import type { NonReducibleUnknown } from "xstate";
import {
  fromPromise as _fromPromise,
  type FromPromise,
} from "./lib/promise.js";

export { xstate } from "./lib/xstate.js";
export type { FromPromise } from "./lib/promise.js";
export type { PromiseActorLogic, PromiseSnapshot } from "./lib/promise.js";
export type {
  PromiseCreator,
  SerialisableActorRef,
  XStateOptions,
  SerialisableScheduledEvent,
  State,
  XStateApi,
  ActorObject,
  ActorObjectHandlers,
} from "./lib/types.js";
/**
 * @deprecated Please import from `@restatedev/xstate/promise`
 */
export const fromPromise: <TOutput, TInput extends NonReducibleUnknown>(
  ...args: Parameters<FromPromise<TOutput, TInput>>
) => ReturnType<FromPromise<TOutput, TInput>> = _fromPromise;
