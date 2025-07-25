/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

import { xstate } from "@restatedev/xstate";
import { describe, it } from "vitest";
import { createRestateTestActor } from "@restatedev/xstate-test";

import { assign, setup, fromCallback } from "xstate";
import { eventually } from "./eventually.js";

export const stopwatchMachine = setup({
  actors: {
    ticks: fromCallback(({ sendBack }) => {
      const interval = setInterval(() => {
        sendBack({ type: "TICK" });
      }, 1000);
      return () => {
        clearInterval(interval);
      };
    }),
  },
}).createMachine({
  id: "stopwatch",
  initial: "stopped",
  context: {
    elapsed: 0,
  },
  states: {
    stopped: {
      on: {
        start: "running",
      },
    },
    running: {
      invoke: {
        src: "ticks",
      },
      on: {
        TICK: {
          actions: assign({
            elapsed: ({ context }) => Number(context.elapsed) + 1,
          }),
        },
        stop: "stopped",
      },
    },
  },
  on: {
    reset: {
      actions: assign({
        elapsed: 0,
      }),
      target: ".stopped",
    },
  },
});

// <!> This test is currently disabled as we do not have a support for `fromCallback`.
// Use cases that require `fromCallback` needed to implement in a different way.
// for example, externally sending events to the machine (instead of internally via fromCallback)
describe("A stopwatch machine", () => {
  it(
    "Will complete successfully",
    { skip: true, timeout: 20_000 },
    async () => {
      const wf = xstate("workflow", stopwatchMachine);

      using actor = await createRestateTestActor<
        { context?: { elapsed?: number } } | undefined
      >({
        machine: wf,
      });

      await actor.send({ type: "start" });

      await eventually(
        async () => (await actor.snapshot())?.context?.elapsed,
      ).toBeGreaterThan(0);
    },
  );
});
