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
import { eventually, runMachine } from "./runner.js";

import { assign, sendParent, setup, type SnapshotFrom } from "xstate";

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

interface PaymentReceivedEvent {
  type: "PaymentReceivedEvent";
  accountId: string;
  payment: {
    amount: number;
  };
  customer: {
    name: string;
  };
  funds: {
    available: boolean;
  };
}

// https://github.com/serverlessworkflow/specification/tree/main/examples#event-based-service-invocation
export const workflow = setup({
  types: {
    events: {} as PaymentReceivedEvent,
    context: {} as {
      payment: {
        amount: number;
      } | null;
      customer: {
        name: string;
      } | null;
      funds: {
        available: boolean;
      } | null;
      accountId: string | null;
    },
  },

  actors: {
    checkfunds: fromPromise(
      async ({
        input,
      }: {
        input: {
          account: string;
          paymentamount: number;
        };
      }) => {
        console.log("Running checkfunds");
        await delay(1000);

        console.log("checkfunds done");

        return {
          available: input.paymentamount < 1000,
        };
      },
    ),
    sendSuccessEmail: fromPromise(async ({ input }) => {
      console.log({ input });
      console.log("Running sendSuccessEmail");
      await delay(1000);

      console.log("sendSuccessEmail done");
    }),
    sendInsufficientFundsEmail: fromPromise(async ({ input }) => {
      console.log({ input });
      console.log("Running sendInsufficientFundsEmail");
      await delay(1000);

      console.log("sendInsufficientFundsEmail done");
    }),
  },
  guards: {
    fundsAvailable: ({ context }) => !!context.funds?.available,
  },
}).createMachine({
  id: "paymentconfirmation",

  initial: "Pending",
  context: {
    customer: null,
    payment: null,
    funds: null,
    accountId: null,
  },
  states: {
    Pending: {
      on: {
        PaymentReceivedEvent: {
          actions: assign({
            accountId: ({ event }) => event.accountId,
            customer: ({ event }) => event.customer,
            payment: ({ event }) => event.payment,
            funds: ({ event }) => event.funds,
          }),
          target: "PaymentReceived",
        },
      },
    },
    PaymentReceived: {
      invoke: {
        src: "checkfunds",
        input: ({ context }) => ({
          account: String(context.accountId),
          paymentamount: Number(context.payment?.amount),
        }),
        onDone: {
          actions: assign({
            funds: ({ event }) => event.output,
          }),
          target: "ConfirmBasedOnFunds",
        },
      },
    },
    ConfirmBasedOnFunds: {
      always: [
        {
          guard: "fundsAvailable",
          target: "SendPaymentSuccess",
        },
        {
          target: "SendInsufficientResults",
        },
      ],
    },
    SendPaymentSuccess: {
      invoke: {
        src: "sendSuccessEmail",
        input: ({ context }) => ({
          applicant: context.customer,
        }),
        onDone: {
          target: "End",
        },
      },
    },
    SendInsufficientResults: {
      invoke: {
        src: "sendInsufficientFundsEmail",
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
      entry: sendParent(({ context }) => ({
        type: "ConfirmationCompletedEvent",
        payment: context.payment,
      })),
    },
  },
});

describe("Reusing functions workflow", () => {
  it("Will complete successfully", { timeout: 20_000 }, async () => {
    const wf = xstate("workflow", workflow);

    using actor = await runMachine<SnapshotFrom<typeof workflow>>({
      machine: wf,
    });

    await actor.send({
      type: "PaymentReceivedEvent",
      accountId: "1234",
      payment: {
        amount: 100,
      },
      customer: {
        name: "John Doe",
      },
      funds: {
        available: true,
      },
    });

    await eventually(async () => {
      const snapshot = await actor.snapshot();
      expect(snapshot.status).toStrictEqual("done");
      expect(snapshot.value).toStrictEqual("End");
    });
  });
});
