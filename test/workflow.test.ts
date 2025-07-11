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

import { xstate, fromPromise } from "../src/public_api.js";
import { describe, it, expect } from "vitest";
import { eventually, runMachine } from "./runner.js";

import { assign, setup } from "xstate";

const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

// this will be set by the test run.
let global_report = {};

// https://github.com/serverlessworkflow/specification/blob/main/examples/README.md#accumulate-room-readings
export const workflow = setup({
  types: {} as {
    events:
      | {
          type: "TemperatureEvent";
          roomId: string;
          temperature: number;
        }
      | {
          type: "HumidityEvent";
          roomId: string;
          humidity: number;
        };
    context: {
      temperature: number | null;
      humidity: number | null;
    };
  },
  delays: {
    PT1H: 1_000,
  },
  actors: {
    produceReport: fromPromise(
      ({
        input,
      }: {
        input: {
          temperature: number | null;
          humidity: number | null;
        };
      }): Promise<void> => {
        global_report = input;
        return Promise.resolve();
      },
    ),
  },
}).createMachine({
  id: "roomreadings",

  initial: "ConsumeReading",
  context: {
    temperature: null,
    humidity: null,
  },
  states: {
    ConsumeReading: {
      entry: assign({
        temperature: null,
        humidity: null,
      }),
      on: {
        TemperatureEvent: {
          actions: assign({
            temperature: ({ event }) => event.temperature,
          }),
        },
        HumidityEvent: {
          actions: assign({
            humidity: ({ event }) => event.humidity,
          }),
        },
      },
      after: {
        PT1H: {
          guard: ({ context }) =>
            context.temperature !== null && context.humidity !== null,
          target: "GenerateReport",
        },
      },
    },
    GenerateReport: {
      invoke: {
        src: "produceReport",
        input: ({ context }) => ({
          temperature: context.temperature,
          humidity: context.humidity,
        }),
        onDone: {
          target: "ConsumeReading",
        },
      },
    },
  },
});

describe("A Temperate workflow", () => {
  it(
    "Will complete the workflow successfully",
    { timeout: 30_000 },
    async () => {
      const wf = xstate("workflow", workflow);

      using actor = await runMachine<{ status?: string } | undefined>({
        machine: wf,
      });

      await actor.send({
        type: "TemperatureEvent",
        roomId: "kitchen",
        temperature: 20,
      });
      await actor.send({
        type: "HumidityEvent",
        roomId: "kitchen",
        humidity: 50,
      });

      await delay(5_000);

      await eventually(() => {
        expect(global_report).toStrictEqual({ temperature: 20, humidity: 50 });
      });
    },
  );
});
