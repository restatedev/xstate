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
          if (
            !req.objectName ||
            !req.event ||
            !req.objectId ||
            typeof req.event !== "object"
          ) {
            throw new restate.TerminalError(
              "Invalid request: objectName, event, and objectId are required",
            );
          }

          const tag = req.tag || watcherDefaults?.defaultTag || "sync";
          const intervalMs =
            req.intervalMs || watcherDefaults?.defaultIntervalMs || 1000;
          const timeoutMs =
            req.timeoutMs || watcherDefaults?.defaultTimeoutMs || 60000;

          // Send event to the machine object
          const machineClient = ctx.objectClient<WatchableXStateApi>(
            { name: req.objectName },
            req.objectId,
          );

          // Send the event to the machine instance
          (machineClient as any).send({
            event: req.event,
            source: "actorWatcherObject/sendWithAwait",
          });
          // Wait for the response
          await ctx.sleep(intervalMs);

          // Start the timer to observe transitions
          const startTime = Date.now();

          let result: WatchResult = {
            timedOut: false,
            waitedMs: Date.now() - startTime,
          };

          while (true) {
            let checkTagResult;
            try {
              checkTagResult = await (machineClient as any).checkTag({ tag });
            } catch (error) {
              console.error(`Error checking tag: ${error}`);
              await ctx.sleep(intervalMs);
            }

            if (
              !checkTagResult ||
              typeof checkTagResult !== "object" ||
              !("isFinal" in checkTagResult) ||
              !("hasTag" in checkTagResult) ||
              !("snapshot" in checkTagResult)
            ) {
              console.error(
                `Invalid response from checkTag object could be still materializing: ${checkTagResult}. Retrying...`,
              );
              await ctx.sleep(intervalMs);
            }
            // Check if the state is final or tag has fallen off
            if (
              checkTagResult &&
              (checkTagResult.isFinal || !checkTagResult.hasTag)
            ) {
              return {
                timedOut: false,
                waitedMs: Date.now() - startTime,
                result: checkTagResult.snapshot,
              };
            }
            // Check if the timeout has been reached
            if (Date.now() - startTime >= timeoutMs) {
              return {
                timedOut: true,
                waitedMs: Date.now() - startTime,
                error: new Error(
                  `Timeout after ${timeoutMs}ms waiting for tag "${tag}" on object "${req.objectName}" with ID "${req.objectId}"`,
                ),
              };
            }
            await ctx.sleep(intervalMs);
          }
        },
      ),
    },
  });
}
