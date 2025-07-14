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

import { xstate, fromPromise } from "@restatedev/xstate";
import { describe, it, expect } from "vitest";
import { createRestateTestActor } from "@restatedev/xstate-test";

import { setup, type SnapshotFrom } from "xstate";

// https://github.com/serverlessworkflow/specification/tree/main/examples#parallel-execution-example
export const workflow = setup({
  actors: {
    shortDelay: fromPromise(async () => {
      await new Promise<void>((resolve) =>
        setTimeout(() => {
          console.log("Resolved shortDelay");
          resolve();
        }, 1000),
      );
    }),
    longDelay: fromPromise(async () => {
      await new Promise<void>((resolve) =>
        setTimeout(() => {
          console.log("Resolved longDelay");
          resolve();
        }, 3000),
      );
    }),
  },
}).createMachine({
  id: "parallel-execution",
  initial: "ParallelExec",
  states: {
    ParallelExec: {
      type: "parallel",
      states: {
        ShortDelayBranch: {
          initial: "active",
          states: {
            active: {
              invoke: {
                src: "shortDelay",
                onDone: "done",
              },
            },
            done: {
              type: "final",
            },
          },
        },
        LongDelayBranch: {
          initial: "active",
          states: {
            active: {
              invoke: {
                src: "longDelay",
                onDone: "done",
              },
            },
            done: {
              type: "final",
            },
          },
        },
      },
      onDone: "Success",
    },
    Success: {
      type: "final",
    },
  },
});

describe("Parallel workflow", () => {
  it("Will complete successfully", { timeout: 20_000 }, async () => {
    const wf = xstate("workflow", workflow);

    using actor = await createRestateTestActor<SnapshotFrom<typeof workflow>>({
      machine: wf,
    });

    await expect
      .poll(() => actor.snapshot(), {
        interval: 250,
        timeout: 20_000,
      })
      .toMatchObject({
        status: "done",
        value: "Success",
      });
  });
});
