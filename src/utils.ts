import type {
  AnyStateMachine,
  AnyActorLogic,
  AnyInvokeConfig,
  AnyActorRef,
} from "xstate";
import type { SerialisableActorRef } from "./types.js";

export function resolveReferencedActor(
  machine: AnyStateMachine,
  src: string,
): AnyActorLogic | undefined {
  const match = src.match(/^xstate\.invoke\.(\d+)\.(.*)/);
  const [, indexStr, nodeId] = match ?? [];
  if (!match || !nodeId) {
    return machine.implementations.actors[src] as AnyActorLogic;
  }
  const node = machine.getStateNodeById(nodeId);
  const invokeConfig = node.config.invoke;
  return (
    Array.isArray(invokeConfig)
      ? (invokeConfig[Number(indexStr)] as AnyInvokeConfig)
      : (invokeConfig as AnyInvokeConfig)
  ).src as AnyActorLogic;
}

export const serialiseActorRef = (
  actorRef: AnyActorRef,
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
