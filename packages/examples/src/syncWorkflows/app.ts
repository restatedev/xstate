import * as restate from "@restatedev/restate-sdk";
import { xstate } from "@restatedev/xstate";
import { fromPromise } from "@restatedev/xstate/promise";
import { createMachine, assign } from "xstate";

// Define the credit card charge state machine
const creditCardChargeMachine = createMachine(
  {
    id: "creditCardCharge",
    initial: "idle",
    types: {} as {
      context: {
        amount: number;
        error: string | null;
        awaitResult: any[];
      };
      events: { type: "START"; amount: number } | { type: "RETRY" };
    },
    context: {
      amount: 0,
      error: null as string | null,
      awaitResult: [],
    },
    states: {
      idle: {
        on: {
          START: {
            target: "authorizing",
            // actions: assign({ amount: (_, event) => event.amount }),
          },
        },
      },
      authorizing: {
        tags: ["sync"],
        invoke: {
          src: "authorizeCard",
          input: ({ event }) => (event as any).input,
          onDone: "notifyUser",
          onError: {
            target: "failed",
            // actions: assign({ error: (_, event) => event.data }),
          },
        },
      },
      notifyUser: {
        tags: ["sync"],
        invoke: {
          src: "notifyUser",
          onDone: "success",
          onError: {
            target: "failed",
            // actions: assign({ error: (_, event) => event.data }),
          },
        },
      },
      success: {
        type: "final",
      },
      failed: {
        type: "final",
      },
    },
  },
  {
    actors: {
      authorizeCard: fromPromise(async ({ input }) => {
        // Simulate authorization logic
        // if (context.amount > 0) return true;
        // throw "Authorization failed";
        console.log("Authorizing card for amount:", input);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return {};
      }),
      notifyUser: fromPromise(async ({ input }) => {
        // Simulate charging logic
        //   if (input.amount < 10000) return true;
        //   throw "Charge declined";
        console.log("Notifying user:", input);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return {};
      }),
    },
  },
);
const creditCardChargeWithSync = xstate("creditCardCharge", creditCardChargeMachine, { watcher: { defaultTag: "sync" } }) as any;

// Register as a restate xstate service
await restate.serve({
  services: [creditCardChargeWithSync, creditCardChargeWithSync.watcher!],
  port: 9083
});
