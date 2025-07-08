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
import { runMachine } from "./runner.js";

import { setup } from "xstate";

// from: https://raw.githubusercontent.com/statelyai/xstate/refs/heads/main/examples/workflow-async-function/main.ts

export const workflow = setup({
  types: {
    input: {} as {
      customer: string;
    },
  },
  actors: {
    sendEmail: fromPromise(
      async ({ input }: { input: { customer: string } }) => {
        console.log("Sending email to", input.customer);

        await new Promise<void>((resolve) =>
          setTimeout(() => {
            console.log("Email sent to", input.customer);
            resolve();
          }, 1),
        );
      },
    ),
  },
}).createMachine({
  id: "async-function-invocation",
  initial: "Send email",
  context: ({ input }) => ({
    customer: input.customer,
  }),
  states: {
    "Send email": {
      invoke: {
        src: "sendEmail",
        input: ({ context }) => ({
          customer: context.customer,
        }),
        onDone: "Email sent",
      },
    },
    "Email sent": {
      type: "final",
    },
  },
});

describe("A fromPromise based state machine", () => {
  it(
    "Will complete the workflow successfully",
    { timeout: 20_000 },
    async () => {
      const wf = xstate("workflow", workflow);

      using machine = await runMachine<{ status?: string } | undefined>({
        machine: wf,
        input: { customer: "bob@mop.com" },
      });

      // eventually the following should be true
      while (true) {
        const snap = await machine.snapshot();
        if (snap?.status === "done") {
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }
    },
  );
});
