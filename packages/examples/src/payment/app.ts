import { log, setup } from "xstate";
import * as restate from "@restatedev/restate-sdk";
import { xstate } from "@restatedev/xstate";
import { fromPromise } from "@restatedev/xstate/promise";

export const machine = setup({
  types: {
    context: {} as {
      paymentID: string;
      senderUserID: string;
      recipientUserID: string;
      amount: number;
    },
    input: {} as {
      senderUserID: string;
      recipientUserID: string;
      amount: number;
    },
    events: {} as { type: "approved" } | { type: "rejected" },
  },
  actions: {
    requestApproval: log(
      ({ context }) => `Requesting approval for ${context.paymentID}`,
    ),
    sendEmail: log(({ context }) => `Sending email to ${context.senderUserID}`),
  },
  actors: {
    updateBalance: fromPromise(
      async ({ input }: { input: { userID: string; amount: number } }) => {
        console.log(`Adding ${input.amount} to the balance of ${input.userID}`);
        // const res = await fetch("https://httpbin.org/get");
        // if (!res.ok) {
        //   throw new Error(`Failed to update balance for ${input.userID}`);
        // }
        // Simulate a delay to mimic a real API call
        // const response = await res.json();
        // console.log(`Dummy API response ${res.status}, ${JSON.stringify(response)}`);
        // return response;
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return { success: true };
      },
    ),
  },
}).createMachine({
  context: ({ input, self }) => ({
    senderUserID: input.senderUserID,
    recipientUserID: input.recipientUserID,
    amount: input.amount,
    paymentID: self.id,
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
      tags: ["sync"],
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
    Succeeded: {
      type: "final",
      entry: log(({ context }) => `Payment ${context.paymentID} succeeded`),
    },
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

const paymentWithSync = xstate("payment", machine, { watcher: { defaultTag: "sync" } }) as any;

await restate.serve({
  services: [paymentWithSync, paymentWithSync.watcher!],
  port: 9081,
});
