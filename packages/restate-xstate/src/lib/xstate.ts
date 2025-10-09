import type { AnyStateMachine } from "xstate";
import type { XStateApi, XStateOptions, XStateWatcherApi } from "./types.js";
import { actorObject } from "./actorObject.js";
import { actorWatcherObject } from "./actorWatcherObject.js";

export const xstate = <
  P extends string,
  LatestStateMachine extends AnyStateMachine,
  PreviousStateMachine extends AnyStateMachine = never,
>(
  path: P,
  logic: LatestStateMachine,
  options?: XStateOptions<PreviousStateMachine>,
): XStateApi<P, LatestStateMachine> | XStateWatcherApi<P, LatestStateMachine> => {
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

  const originalActor = actorObject(path, logic, options);

  if (options?.watcher && options?.watcher.defaultTag !== '') {
    const finalActor = originalActor as XStateWatcherApi<P, LatestStateMachine>;
    // Note: '/' is not allowed in object names
    // Create a corresponding watcher object for the original actor
    finalActor.watcher = actorWatcherObject(`${path}.watcher`, options.watcher);
  }


  return originalActor;
};
