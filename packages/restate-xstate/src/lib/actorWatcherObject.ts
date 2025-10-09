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

          const tag = req.tag || watcherDefaults?.defaultTag || "sync";
          const intervalMs =
            req.intervalMs || watcherDefaults?.defaultIntervalMs || 1000;
          const timeoutMs =
            req.timeoutMs || watcherDefaults?.defaultTimeoutMs || 60000;

          // Send event to the machine object
          const machineClient = ctx.objectClient<WatchableXStateApi>(
            { name: originalMachineName } as unknown as restate.VirtualObjectDefinition<string, WatchableXStateApi>,
            ctx.key,
          );
          if (!machineClient) {
            throw new restate.TerminalError(
              `Machine object ${originalMachineName} not found`,
            );
          }

          console.log(
            `Sending event ${JSON.stringify(req.event)} to machine:${originalMachineName}, with key:${ctx.key}, with tag:${tag}`,
          );

          // Send the event to the machine instance
          try {
            (machineClient as any).send({
              event: req.event,
              source: "actorWatcherObject/sendWithAwait",
            });
          } catch (error) {
            console.error(`Error sending event to ${originalMachineName} machine: ${error}`);
            throw new restate.TerminalError(
              `Error sending event to machine ${originalMachineName}: ${error}`,
            );
          }

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
            console.log(`Checking tag "${tag}" on object "${originalMachineName}" with ID "${ctx.key}"`);
            try {
              checkTagResult = await (machineClient as any).checkTag({ tag });
            } catch (error) {
              console.error(`Error checking tag: ${error}`);
              await ctx.sleep(intervalMs);
            }
            console.log(`CheckTag Result on object "${originalMachineName}" with ID "${ctx.key}, Result: ${JSON.stringify(checkTagResult)}`);
            // Check if the response is valid
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
