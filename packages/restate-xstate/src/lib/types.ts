import type { ObjectSharedContext } from "@restatedev/restate-sdk";
import type { NonReducibleUnknown } from "xstate";

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
