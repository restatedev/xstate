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

import {
  assign,
  createMachine,
  forwardTo,
  sendParent,
  setup,
  type SnapshotFrom,
} from "xstate";
import { eventually } from "./eventually.js";

function delay(ms: number): Promise<void> {
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

interface ConfirmationCompletedEvent {
  type: "ConfirmationCompletedEvent";
  payment: {
    amount: number;
  };
}

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
        await delay(10);

        console.log("checkfunds done");

        return {
          available: input.paymentamount < 1000,
        };
      },
    ),
    sendSuccessEmail: fromPromise(({ input }) => {
      console.log({ input });
      console.log("Running sendSuccessEmail");
      console.log("sendSuccessEmail done");
      return Promise.resolve();
    }),
    sendInsufficientFundsEmail: fromPromise(({ input }) => {
      console.log({ input });
      console.log("Running sendInsufficientFundsEmail");
      console.log("sendInsufficientFundsEmail done");
      return Promise.resolve();
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
      entry: sendParent(
        () =>
          ({
            type: "ConfirmationCompletedEvent",
            payment: { amount: 1337 },
          }) satisfies ConfirmationCompletedEvent,
      ),
    },
  },
});

const parentWorkflow = createMachine({
  id: "parent",
  types: {} as {
    events: PaymentReceivedEvent | ConfirmationCompletedEvent;
  },
  invoke: {
    id: "paymentconfirmation",
    src: workflow,
  },
  on: {
    PaymentReceivedEvent: { actions: forwardTo("paymentconfirmation") },
    ConfirmationCompletedEvent: {
      actions: assign({
        payment: ({ event }) => event.payment,
      }),
    },
  },
});

describe("Reusing functions workflow", () => {
  it("Will complete successfully", { timeout: 20_000 }, async () => {
    const wf = xstate("workflow", parentWorkflow);

    using actor = await createRestateTestActor<
      SnapshotFrom<typeof parentWorkflow>
    >({
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

    await eventually(() => actor.snapshot()).toMatchObject({
      context: {
        payment: {
          amount: 1337,
        },
      },
    });
  });
});
