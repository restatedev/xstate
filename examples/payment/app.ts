import { log, setup } from "xstate";
import * as restate from "@restatedev/restate-sdk";
import { fromPromise, bindXStateRouter } from "@restatedev/xstate";

export const machine = setup({
  types: {
    context: {} as {
      paymentID: string;
      senderUserID: string;
      recipientUserID: string;
      amount: number;
    },
    input: {} as {
      ctx: restate.ObjectContext;
      senderUserID: string;
      recipientUserID: string;
      amount: number;
    },
    events: {} as { type: "approved" } | { type: "rejected" },
  },
  actions: {
    requestApproval: log(
      ({ context }) => `Requesting approval for ${context.paymentID}`
    ),
    sendEmail: log(({ context }) => `Sending email to ${context.senderUserID}`),
  },
  actors: {
    updateBalance: fromPromise(
      async ({
        input,
        ctx,
      }: {
        input: { userID: string; amount: number };
        ctx: restate.ObjectSharedContext;
      }) => {
        ctx.console.log(
          `Adding ${input.amount} to the balance of ${input.userID}`
        );
        const res = await fetch("https://httpbin.org/get");
        return res.json();
      }
    ),
  },
}).createMachine({
  context: ({ input }) => ({
    senderUserID: input.senderUserID,
    recipientUserID: input.recipientUserID,
    amount: input.amount,
    paymentID: input.ctx.key,
  }),
  id: "Payment",
  initial: "Awaiting approval",
  states: {
    "Awaiting approval": {
      on: {
        approved: {
          target: "Approved",
        },
        rejected: {
          target: "Rejected",
        },
      },
      after: {
        "10000": {
          target: "Awaiting manual approval",
        },
      },
      entry: {
        type: "requestApproval",
      },
    },
    Approved: {
      invoke: {
        input: ({ context }) => ({
          userID: context.senderUserID,
          amount: context.amount,
        }),
        onDone: {
          target: "Debited",
        },
        onError: {
          target: "Cancelled",
        },
        src: "updateBalance",
      },
    },
    "Awaiting manual approval": {
      on: {
        approved: {
          target: "Approved",
        },
        rejected: {
          target: "Rejected",
        },
      },
      entry: {
        type: "sendEmail",
      },
    },
    Rejected: {},
    Cancelled: {},
    Debited: {
      invoke: {
        input: ({ context }) => ({
          userID: context.recipientUserID,
          amount: context.amount,
        }),
        onDone: {
          target: "Succeeded",
        },
        onError: {
          target: "Refunding",
        },
        src: "updateBalance",
      },
    },
    Succeeded: {},
    Refunding: {
      invoke: {
        input: ({ context }) => ({
          userID: context.senderUserID,
          amount: context.amount,
        }),
        onDone: {
          target: "Cancelled",
        },
        src: "updateBalance",
      },
    },
  },
});

await bindXStateRouter(restate.endpoint(), "payment", machine).listen();