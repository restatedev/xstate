/**
 * @license
 * This object will provide a side car handlers (sendWithAwait) to state machines represented in actorObject.
 * These handlers will be used to send events to the state machine, on behalf of the clients that await for the response to the events.
 */

import * as restate from "@restatedev/restate-sdk";
import {
  ValidWatchCondition,
  type WatchableXStateApi,
  type WatcherDefaults,
  type WatchRequest,
  type WatchResult,
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

          // Start the timer to observe transitions
          const startTime = Date.now();
          if (!ctx.key || !req.event || typeof req.event !== "object") {
            throw new restate.TerminalError(
              "Invalid request: key, event are required",
            );
          }

          const originalMachineName = watcherName.replace(/\.watcher/g, "");
          const eventWatchUntils = watcherDefaults?.events?.find(
            (definedEvent) => definedEvent.event === req.event.type && definedEvent.condition === req.until?.condition,
          );
          if (!eventWatchUntils) {
            throw new restate.TerminalError(
              `Event ${req.event.type} is not defined while defining watcher defaults`,
            );
          }
          
          if (
            !eventWatchUntils?.condition ||
            !Object.values(ValidWatchCondition).includes(eventWatchUntils.condition)
          ) {
            throw new restate.TerminalError(
              "Invalid event request: watcher 'condition' must be one of ValidWatchCondition values",
            );
          }

          if (
            eventWatchUntils?.condition === "result" &&
            !eventWatchUntils.resultKey
          ) {
            throw new restate.TerminalError(
              "Invalid request: 'resultKey' must be provided when 'condition' is 'result'",
            );
          }
          if (
            (eventWatchUntils?.condition === "tagObserved" ||
              eventWatchUntils?.condition === "tagCleared") &&
            !eventWatchUntils.observeTag
          ) {
            throw new restate.TerminalError(
              "Invalid request: 'observeTag' must be provided when 'condition' is 'tagObserved' or 'tagCleared'",
            );
          }

          const condition = eventWatchUntils?.condition;
          const resultKey = eventWatchUntils?.resultKey;
          const observeTag = eventWatchUntils?.observeTag;
          const intervalMs =
            req.intervalMs || watcherDefaults?.intervalMs || 1000;
          const timeoutMs =
            req.timeoutMs || watcherDefaults?.timeoutMs || 60000;

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
            condition,
            observeTag,
            resultKey,
            intervalMs,
            timeoutMs,
          })) as WatchResult;

          console.log(
            `Received response from machine: ${originalMachineName}, with key:${ctx.key}. Result: ${JSON.stringify(result)}`,
          );
          result.waitedMs = Date.now() - startTime;
          return result;
          
        },
      ),
    },
  });
}
