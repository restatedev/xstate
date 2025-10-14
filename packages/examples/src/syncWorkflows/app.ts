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
        authStatus?: string;
        notifyStatus?: string;
      };
      events: { type: "START"; amount: number } | { type: "RETRY" };
    },
    context: {
      amount: 0,
      error: null as string | null,
      authStatus: undefined,
      notifyStatus: undefined,
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
        invoke: {
          src: "authorizeCard",
          input: ({ event }) => (event as any).input,
          onDone: {
            target: "notifyUser",
            actions: assign({
              authStatus: ({ event }) => event.output.status,
            }),
          },
          onError: {
            target: "failed",
            // actions: assign({ error: (_, event) => event.data }),
          },
        },
      },
      notifyUser: {
        invoke: {
          src: "notifyUser",
          onDone: {
            target: "success",
            actions: assign({
              notifyStatus: ({ event }) => event.output.status,
            }),
          },
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
        return { status: "auth-success" };
      }),
      notifyUser: fromPromise(async ({ input }) => {
        // Simulate charging logic
        //   if (input.amount < 10000) return true;
        //   throw "Charge declined";
        console.log("Notifying user:", input);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return { status: "notify-success" };
      }),
    },
  },
);

const transactionMachine = createMachine(
  {
    id: "transaction",
    initial: "idle",
    types: {} as {
      context: {
        error: string | null;
        transactionStatus?: string;
      };
    },
    context: {
      error: null as string | null,
      transactionStatus: undefined,
    },
    states: {
      idle: {
        on: {
          START: {
            target: "commitTransaction",
          },
        },
      },
      commitTransaction: {
        tags: ["transactionCommit"],
        initial: "step1",
        states: {
          step1: {
            invoke: {
              src: "commitStep1",
              onDone: {
                target: "step2",
              },
              onError: {
                target: "#transaction.failed",
              },
            },
          },
          step2: {
            tags: ["transactionStep2Commit"],
            invoke: {
              src: "commitStep2",
              onDone: {
                target: "step3",
              },
              onError: {
                target: "#transaction.failed",
              },
            },
          },
          step3: {
            invoke: {
              src: "commitStep3",
              onDone: {
                target: "step4",
              },
              onError: {
                target: "#transaction.failed",
              },
            },
          },
          step4: {
            invoke: {
              src: "commitStep4",
              onDone: {
                target: "#transaction.success",
              },
              onError: {
                target: "#transaction.failed",
              },
            },
          }
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
      commitStep1: fromPromise(async ({ input }) => {
        // Simulate Step1 async logic
        console.log("Committing Step 1:", input);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return { status: "step1-success" };
      }),
      commitStep2: fromPromise(async ({ input }) => {
        // Simulate Step2 async logic
        console.log("Committing Step 2:", input);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return { status: "step2-success" };
      }),
      commitStep3: fromPromise(async ({ input }) => {
        // Simulate Step3 async logic
        console.log("Committing Step 3:", input);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return { status: "step3-success" };
      }),
      commitStep4: fromPromise(async ({ input }) => {
        // Simulate Step4 async logic
        console.log("Committing Step 4:", input);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return { status: "step4-success" };
      }),
    },
  },
);

const creditCardChargeWithSync = xstate(
  "creditCardCharge",
  creditCardChargeMachine,
  {
    watcher: {
      events: [{ event: "START", until: "result", resultKey: "notifyStatus" }],
    },
  },
) as any;

const transactionWithSync = xstate(
  "transaction",
  transactionMachine,
  {
    watcher: {
      events: [{ event: "START", until: "tagCleared", observedTag: "transactionCommit" }], // Event response will be sent when the tag is cleared
      //   events: [{ event: "START", until: "tagObserved", observedTag: "transactionStep2Commit" }], // Event response will be sent when the tag is observed
      
      // You can also use 'final' as the until condition
      //   until: "final", // Will wait for the machine to reach a final state
      //   until: "tagObserved" or "tagCleared", // Will wait for the value in observedTag to be observed/cleared
      //   until: "result", resultKey: "transactionStatus", // Will return the value of this key from the state machine context
      // You can also define multiple events with different until conditions
    
    },
  },
) as any;

// Register as a restate xstate service
await restate.serve({
  services: [creditCardChargeWithSync, creditCardChargeWithSync.watcher!, transactionWithSync, transactionWithSync.watcher!],
  port: 9083,
});
