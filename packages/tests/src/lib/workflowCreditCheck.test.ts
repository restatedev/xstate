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
import { fromPromise } from "@restatedev/xstate/promise";

import { setup, assign, type SnapshotFrom } from "xstate";
import { eventually } from "./eventually.js";

interface Customer {
  id: string;
  name: string;
  SSN: number;
  yearlyIncome: number;
  address: string;
  employer: string;
}

// https://github.com/serverlessworkflow/specification/tree/main/examples#perform-customer-credit-check-example
export const workflow = setup({
  types: {
    context: {} as {
      customer: Customer;
      creditCheck: {
        decision: "Approved" | "Denied";
      } | null;
    },
    input: {} as {
      customer: Customer;
    },
  },
  actors: {
    callCreditCheckMicroservice: fromPromise(
      ({ input }: { input: { customer: Customer } }) => {
        console.log("calling credit check microservice", input);
        return Promise.resolve({
          id: "customer123",
          score: 700,
          decision: "Approved" as const,
          reason: "Good credit score",
        });
      },
    ),
    startApplicationWorkflowId: fromPromise(
      async ({ input }: { input: { customer: Customer } }) => {
        console.log("starting application workflow", input);
        // fake 1s
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return {
          application: {
            id: "application123",
            status: "Approved",
          },
        };
      },
    ),
    sendRejectionEmailFunction: fromPromise(
      async ({ input }: { input: { applicant: Customer } }) => {
        console.log("sending rejection email", input);
        // fake 1s
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return {
          email: {
            id: "email123",
            status: "Sent",
          },
        };
      },
    ),
  },
  delays: {
    PT15M: 15 * 60 * 1000,
  },
}).createMachine({
  id: "customercreditcheck",
  initial: "CheckCredit",
  context: ({ input }) => ({
    customer: input.customer,
    creditCheck: null,
  }),
  states: {
    CheckCredit: {
      invoke: {
        src: "callCreditCheckMicroservice",
        input: ({ context }) => ({
          customer: context.customer,
        }),
        onDone: {
          target: "EvaluateDecision",
          actions: assign({
            creditCheck: ({ event }) => event.output,
          }),
        },
      },
      // timeout
      after: {
        PT15M: "Timeout",
      },
    },
    EvaluateDecision: {
      always: [
        {
          guard: ({ context }) => context.creditCheck?.decision === "Approved",
          target: "StartApplication",
        },
        {
          guard: ({ context }) => context.creditCheck?.decision === "Denied",
          target: "RejectApplication",
        },
        {
          target: "RejectApplication",
        },
      ],
    },
    StartApplication: {
      invoke: {
        src: "startApplicationWorkflowId",
        input: ({ context }) => ({
          customer: context.customer,
        }),
        onDone: {
          target: "End",
        },
      },
    },
    RejectApplication: {
      invoke: {
        src: "sendRejectionEmailFunction",
        input: ({ context }) => ({
          applicant: context.customer,
        }),
        onDone: {
          target: "End",
        },
      },
    },
    End: {
      type: "final",
    },

    Timeout: {},
  },
  output: ({ context }) => ({
    decision: context.creditCheck?.decision,
  }),
});

describe("A credit check  workflow", () => {
  it("Will complete successfully", { timeout: 30_000 }, async () => {
    const wf = xstate("workflow", workflow);

    using actor = await createRestateTestActor<SnapshotFrom<typeof workflow>>({
      machine: wf,
      input: {
        customer: {
          id: "customer123",
          name: "John Doe",
          SSN: 123456,
          yearlyIncome: 50000,
          address: "123 MyLane, MyCity, MyCountry",
          employer: "MyCompany",
        },
      },
    });

    await eventually(async () => (await actor.snapshot()).output).toMatchObject(
      {
        decision: "Approved",
      },
    );
  });
});
