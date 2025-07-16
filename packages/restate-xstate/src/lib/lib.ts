import type { AnyStateMachine } from "xstate";
import type { XStateOptions } from "./types.js";
import { actorObject, type XStateApi } from "./actorObject.js";

export const xstate = <
  P extends string,
  LatestStateMachine extends AnyStateMachine,
  PreviousStateMachine extends AnyStateMachine = never,
>(
  path: P,
  logic: LatestStateMachine,
  options?: XStateOptions<PreviousStateMachine>,
): XStateApi<P, LatestStateMachine> => {
  if (options?.versions) {
    const idsSet = new Set<string>();
    for (const version of options.versions) {
      if (version.id == logic.id)
        throw new Error(
          `State machine ID ${version.id} is used in both the latest and a previous version; IDs must be unique across versions`,
        );
      if (idsSet.has(version.id))
        throw new Error(
          `State machine ID ${version.id} is used in two previous versions; IDs must be unique across versions`,
        );
      idsSet.add(version.id);
    }
  }

  return actorObject(path, logic, options);
};
