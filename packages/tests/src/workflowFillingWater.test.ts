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

import { xstate } from "../src/public_api.js";
import { describe, it, expect } from "vitest";
import { eventually, runMachine } from "./runner.js";

import { createMachine, assign } from "xstate";

// https://github.com/serverlessworkflow/specification/blob/main/examples/README.md#filling-a-glass-of-water
export const workflow = createMachine({
  id: "fillglassofwater",
  types: {} as {
    events: {
      type: "WaterAddedEvent";
    };
    context: {
      counts: {
        current: number;
        max: number;
      };
    };
    input: {
      current: number;
      max: number;
    };
  },
  initial: "CheckIfFull",
  context: ({ input }) => ({
    counts: input,
  }),
  states: {
    CheckIfFull: {
      always: [
        {
          target: "AddWater",
          guard: ({ context }) => context.counts.current < context.counts.max,
        },
        {
          target: "GlassFull",
        },
      ],
    },
    AddWater: {
      after: {
        500: {
          actions: assign({
            counts: ({ context }) => ({
              ...context.counts,
              current: context.counts.current + 1,
            }),
          }),
          target: "CheckIfFull",
        },
      },
    },
    GlassFull: {
      type: "final",
    },
  },
});

describe("Fill water workflow", () => {
  it("Will complete successfully", { timeout: 20_000 }, async () => {
    const wf = xstate("workflow", workflow);

    using actor = await runMachine<any>({
      machine: wf,
      input: {
        current: 0,
        max: 10,
      },
    });

    await eventually(async () => {
      const snapshot = await actor.snapshot();
      expect(snapshot?.status).toStrictEqual("done");
      expect(snapshot?.value).toStrictEqual("GlassFull");
    });
  });
});
