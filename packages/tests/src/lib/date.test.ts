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
import { fromPromise } from "@restatedev/xstate/promise";
import { assign, setup } from "xstate";
import { describe, it, expect } from "vitest";
import { createRestateTestActor } from "@restatedev/xstate-test";

let submittedAt = -1;
const dateMachine = setup({
  actors: {
    getCurrentDate: fromPromise(async ({ ctx }) => ctx.date.now()),
  },
}).createMachine({
  id: "date",
  context: { submittedAt: 0, restateDate: 0 },
  initial: "idle",
  states: {
    idle: {
      on: {
        submit: {
          target: "gettingRestateDate",
          actions: assign({
            submittedAt: () => {
              const date = Date.now();
              if (submittedAt < 0) {
                submittedAt = date;
              }
              return date;
            }, // or computed inline
          }),
        },
      },
    },
    gettingRestateDate: {
      invoke: {
        src: "getCurrentDate",
        onDone: {
          target: "done",
          actions: assign({
            restateDate: ({ event }) => event.output,
          }),
        },
      },
    },
    done: {
      type: "final",
      // or capture on state entry:
      // entry: assign({ enteredAt: () => Date.now() })
    },
  },
});

describe("Date machine", () => {
  it(
    "Should capture native and Restate dates",
    { timeout: 20_000 },
    async () => {
      const dateObject = xstate("date", dateMachine);

      using machine = await createRestateTestActor<{
        context: { submittedAt: number; restateDate: number };
      }>(
        {
          machine: dateObject,
        },
        { alwaysReplay: true, disableRetries: true },
      );

      await machine.send({ type: "submit" });

      const snap = await machine.waitFor("done");
      expect(snap.context.submittedAt).toBe(submittedAt);
      expect(snap.context.restateDate).toBeGreaterThanOrEqual(submittedAt);
    },
  );
});
