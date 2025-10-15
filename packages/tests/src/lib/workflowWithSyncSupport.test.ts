import { xstate } from "@restatedev/xstate";
import { describe, it } from "vitest";
import { createRestateTestActor } from "@restatedev/xstate-test";
import { fromPromise } from "@restatedev/xstate/promise";
import { setup, assign, type SnapshotFrom } from "xstate";
import { eventually } from "./eventually.js";
import { error } from "console";

const workflow = setup({
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
    recordTransaction: fromPromise(async ({ input }) => {
      // Simulate recording transaction logic
      console.log("Recording transaction:", input);
      await new Promise((resolve) => setTimeout(resolve, 4000));
      return { status: "transaction-recorded" };
    }),
  },
}).createMachine({
  id: "transaction",
  context: {
    error: null as string | null,
    transactionStatus: undefined,
    senderUserID: "",
    recipientUserID: "",
    amount: 0,
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
              target: "#transaction.recordTransaction",
            },
            onError: {
              target: "#transaction.failed",
            },
          },
        },
      },
    },
    recordTransaction: {
      invoke: {
        src: "recordTransaction",
        onDone: {
          target: "success",
          actions: assign({
            transactionStatus: ({ event }) => event.output.status,
          }),
        },
        onError: {
          target: "failed",
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
});

describe("An event based workflow with sync support", () => {
  it("Will complete successfully", { timeout: 20_000 }, async () => {
    const wf = xstate("workflow", workflow);

    using actor = await createRestateTestActor<SnapshotFrom<typeof workflow>>({
      machine: wf,
      input: {
        senderUserID: "user1",
        recipientUserID: "user2",
        amount: 100,
      },
    });

    await actor.send({
      type: "START",
    });

    await eventually(() => actor.snapshot()).toMatchObject({
          status: "done",
          value: "success",
          context: {
            error: null,
            senderUserID: "user1",
            recipientUserID: "user2",
            amount: 100,
            transactionStatus: "transaction-recorded",
          }
    });

  });
});
