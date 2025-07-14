/* eslint-disable @typescript-eslint/no-unsafe-return */
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
import { describe, it } from "vitest";
import { createRestateTestActor } from "@restatedev/xstate-test";

import { createMachine, assign, type SnapshotFrom } from "xstate";
import { eventually } from "./eventually.js";

async function delay(ms: number, errorProbability: number = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (Math.random() < errorProbability) {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject({ type: "ServiceNotAvailable" });
      } else {
        resolve();
      }
    }, ms);
  });
}

const vitalsWorkflow = createMachine(
  {
    id: "vitalscheck",
    context: {
      tirePressure: null,
      oilPressure: null,
      coolantLevel: null,
      battery: null,
    } as {
      tirePressure: null | number;
      oilPressure: null | number;
      coolantLevel: null | number;
      battery: null | number;
    },
    initial: "CheckVitals",
    states: {
      CheckVitals: {
        invoke: [
          {
            src: "checkTirePressure",
            onDone: {
              actions: assign({
                tirePressure: ({ event }) => event.output,
              }),
            },
          },
          {
            src: "checkOilPressure",
            onDone: {
              actions: assign({
                oilPressure: ({ event }) => event.output,
              }),
            },
          },
          {
            src: "checkCoolantLevel",
            onDone: {
              actions: assign({
                coolantLevel: ({ event }) => event.output,
              }),
            },
          },
          {
            src: "checkBattery",
            onDone: {
              actions: assign({
                battery: ({ event }) => event.output,
              }),
            },
          },
        ],
        always: {
          guard: ({ context }) => {
            return !!(
              context.tirePressure &&
              context.oilPressure &&
              context.coolantLevel &&
              context.battery
            );
          },
          target: "VitalsChecked",
        },
      },
      VitalsChecked: {
        type: "final",
      },
    },
    output: ({ context }) => context,
  },
  {
    actors: {
      checkTirePressure: fromPromise(async () => {
        console.log("Starting checkTirePressure");
        await delay(10);
        console.log("Completed checkTirePressure");
        return { value: 100 };
      }),
      checkOilPressure: fromPromise(async () => {
        console.log("Starting checkOilPressure");
        await delay(150);
        console.log("Completed checkOilPressure");
        return { value: 100 };
      }),
      checkCoolantLevel: fromPromise(async () => {
        console.log("Starting checkCoolantLevel");
        await delay(50);
        console.log("Completed checkCoolantLevel");
        return { value: 100 };
      }),
      checkBattery: fromPromise(async () => {
        console.log("Starting checkBattery");
        await delay(120);
        console.log("Completed checkBattery");
        return { value: 100 };
      }),
    },
  },
);

describe("A car vitals workflow", () => {
  it("Will complete successfully", { timeout: 20_000 }, async () => {
    const wf = xstate("workflow", vitalsWorkflow);

    using actor = await createRestateTestActor<
      SnapshotFrom<typeof vitalsWorkflow>
    >({
      machine: wf,
    });

    await actor.send({
      type: "CarTurnedOnEvent",
    });

    await actor.send({
      type: "CarTurnedOffEvent",
    });

    await eventually(() => actor.snapshot()).toMatchObject({
      output: {
        tirePressure: { value: 100 },
        oilPressure: { value: 100 },
        coolantLevel: { value: 100 },
        battery: { value: 100 },
      },
    });
  });
});
