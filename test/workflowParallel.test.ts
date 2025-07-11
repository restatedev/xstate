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
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable no-constant-condition */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { xstate, fromPromise } from "../src/public_api.js";
import { describe, it, expect } from "vitest";
import { eventually, runMachine } from "./runner.js";

import { setup } from "xstate";

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

    using actor = await runMachine<any>({
      machine: wf,
    });

    await eventually(async () => {
      const snapshot = await actor.snapshot();
      expect(snapshot?.status).toStrictEqual("done");
      expect(snapshot?.value).toStrictEqual("Success");
    });
  });
});
