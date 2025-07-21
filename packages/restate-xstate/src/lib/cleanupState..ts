import type { AnyStateMachine } from "xstate";
import type { State, XStateApi, ActorObjectHandlers } from "./types.js";
import * as restate from "@restatedev/restate-sdk";

export async function validateStateMachineIsNotDisposed(
  ctx: restate.ObjectContext<State> | restate.ObjectSharedContext<State>,
) {
  const isDisposed = (await ctx.get("disposed")) === true;
  if (isDisposed) {
    throw new restate.TerminalError(
      "The state machine has been disposed after reaching it's final state",
      { errorCode: 410 },
    );
  }
}

export async function checkIfStateMachineShouldBeDisposed<
  LatestStateMachine extends AnyStateMachine,
>(
  ctx: restate.ObjectContext<State>,
  api: XStateApi<string, LatestStateMachine>,
  systemName: string,
  finalStateTTL?: number,
) {
  const snapshot = await ctx.get("snapshot");
  const shouldCleanUp =
    snapshot?.status === "done" &&
    typeof finalStateTTL === "number" &&
    finalStateTTL !== Infinity;

  if (shouldCleanUp) {
    ctx
      .objectSendClient<
        ActorObjectHandlers<LatestStateMachine>
      >(api, systemName)
      .cleanupState(
        restate.SendOpts.from({
          delay: { milliseconds: finalStateTTL },
        }),
      );
  }
}
