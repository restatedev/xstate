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
import { createMachine, assign } from "xstate";
import { describe, it, expect } from "vitest";
import { createRestateTestActor } from "@restatedev/xstate-test";

let submittedAt = -1;
const dateMachine = createMachine({
  id: "date",
  context: { submittedAt: 0 },
  initial: "idle",
  states: {
    idle: {
      on: {
        submit: {
          target: "done",
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
    done: {
      // or capture on state entry:
      // entry: assign({ enteredAt: () => Date.now() })
    },
  },
});

describe("Simple count machine", () => {
  it("Should capture the date correctly", { timeout: 20_000 }, async () => {
    const counter = xstate("date", dateMachine);

    using machine = await createRestateTestActor<{
      context: { submittedAt: number };
    }>({
      machine: counter,
    });

    await machine.send({ type: "submit" });

    const snap = await machine.snapshot();
    expect(snap.context.submittedAt).toBe(submittedAt);
  });
});
