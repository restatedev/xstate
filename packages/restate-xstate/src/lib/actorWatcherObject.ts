/**
 * @license
 * This object will provide a side car handlers (sendWithAwait) to state machines represented in actorObject.
 * These handlers will be used to send events to the state machine, on behalf of the clients that await for the response to the events.
 */

import * as restate from "@restatedev/restate-sdk";
import type {
  WatchableXStateApi,
  WatcherDefaults,
  WatchRequest,
  WatchResult,
} from "./types.js";

export function actorWatcherObject(
  watcherName: string,
  watcherDefaults?: WatcherDefaults,
) {
  return restate.object({
    name: watcherName,
    handlers: {
      sendWithAwait: restate.handlers.object.exclusive(
        async (
          ctx: restate.ObjectContext<any>,
          req: WatchRequest,
        ): Promise<WatchResult> => {
          if (!ctx.key || !req.event || typeof req.event !== "object") {
            throw new restate.TerminalError(
              "Invalid request: key, event are required",
            );
          }

          const originalMachineName = watcherName.replace(/\.watcher/g, "");
          const eventWatchUntils = watcherDefaults?.events?.find(
            (definedEvent) => definedEvent.event === req.event.type,
          );
          if (!eventWatchUntils) {
            throw new restate.TerminalError(
              `Event ${req.event.type} is not defined in watcher defaults`,
            );
          }
          if (
            !eventWatchUntils?.until ||
            !["final", "tagObserved", "tagCleared", "result"].includes(
              eventWatchUntils.until,
            )
          ) {
            throw new restate.TerminalError(
              "Invalid request: 'until' must be one of 'final', 'tagObserved', 'tagCleared', or 'result'",
            );
          }

          if (
            eventWatchUntils?.until === "result" &&
            !eventWatchUntils.resultKey
          ) {
            throw new restate.TerminalError(
              "Invalid request: 'resultKey' must be provided when 'until' is 'result'",
            );
          }

          const until = eventWatchUntils?.until;
          const resultKey = eventWatchUntils?.resultKey;
          const tag = eventWatchUntils?.observedTag;
          const intervalMs =
            req.intervalMs || watcherDefaults?.intervalMs || 1000;
          const timeoutMs =
            req.timeoutMs || watcherDefaults?.timeoutMs || 30000;

          // Send event to the machine object
          const machineClient = ctx.objectClient<WatchableXStateApi>(
            {
              name: originalMachineName,
            } as unknown as restate.VirtualObjectDefinition<
              string,
              WatchableXStateApi
            >,
            ctx.key,
          );
          if (!machineClient) {
            throw new restate.TerminalError(
              `Machine object ${originalMachineName} not found`,
            );
          }

          // Start the timer to observe transitions
          const startTime = Date.now();

          console.log(
            `Sending event ${JSON.stringify(req.event)} to machine:${originalMachineName}, with key:${ctx.key}, with request:${req}`,
          );

          // Send the event to the machine instance
          try {
            (machineClient as any).send({
              event: req.event,
              source: "actorWatcherObject/sendWithAwait",
            });
          } catch (error) {
            console.error(
              `Error sending event to ${originalMachineName} machine: ${error}`,
            );
            throw new restate.TerminalError(
              `Error sending event to machine ${originalMachineName}: ${error}`,
            );
          }

          

          // Sleep for the initial interval for send event to materialize
          console.log(
            `Sleeping for ${intervalMs}ms to allow event to materialize in machine: ${originalMachineName}, with key: ${ctx.key}`,
          );
          await ctx.sleep(intervalMs);

          console.log(
            `Waiting for response from machine:${originalMachineName}, with key:${ctx.key}`,
          );
          let result: WatchResult = (await (machineClient as any).waitFor({
            until,
            tag,
            resultKey,
            intervalMs,
            timeoutMs,
          })) as WatchResult;

          console.log(
            `Received response from machine: ${originalMachineName}, with key:${ctx.key}. Result: ${JSON.stringify(result)}`,
          );
          return result;
          
        },
      ),
    },
  });
}
