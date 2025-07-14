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
import { describe, it } from "vitest";
import { createRestateTestActor } from "@restatedev/xstate-test";

import { setup, type SnapshotFrom } from "xstate";
import { eventually } from "./eventually.js";

interface Order {
  id: string;
  item: string;
  quantity: string;
}

// https://github.com/serverlessworkflow/specification/tree/main/examples#provision-orders-example
export const workflow = setup({
  types: {
    context: {} as {
      order: Order;
    },
    input: {} as { order: Order },
  },
  actors: {
    provisionOrderFunction: fromPromise(
      async ({ input }: { input: { order: Order } }) => {
        console.log("starting provisionOrderFunction");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (!input.order.id) {
          throw new Error("Missing order id");
        }
        if (!input.order.item) {
          throw new Error("Missing order item");
        }
        if (!input.order.quantity) {
          throw new Error("Missing order quantity");
        }
        console.log("finished provisionOrderFunction");
        return {
          order: input.order,
        };
      },
    ),
    applyOrderWorkflowId: fromPromise(async () => {
      console.log("starting applyOrderWorkflowId");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      console.log("finished applyOrderWorkflowId");
      return;
    }),
    handleMissingIdExceptionWorkflow: fromPromise(async () => {
      console.log("starting handleMissingIdExceptionWorkflow");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      console.log("finished handleMissingIdExceptionWorkflow");
      return;
    }),
    handleMissingItemExceptionWorkflow: fromPromise(async () => {
      console.log("starting handleMissingItemExceptionWorkflow");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      console.log("finished handleMissingItemExceptionWorkflow");
      return;
    }),
    handleMissingQuantityExceptionWorkflow: fromPromise(async () => {
      console.log("starting handleMissingQuantityExceptionWorkflow");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      console.log("finished handleMissingQuantityExceptionWorkflow");
      return;
    }),
  },
}).createMachine({
  id: "provisionorders",

  initial: "ProvisionOrder",
  context: ({ input }) => ({
    order: input.order,
  }),
  states: {
    ProvisionOrder: {
      invoke: {
        src: "provisionOrderFunction",
        input: ({ context }) => ({
          order: context.order,
        }),
        onDone: "ApplyOrder",
        onError: [
          {
            guard: ({ event }) =>
              (event.error as Error).message === "Missing order id",
            target: "Exception.MissingId",
          },
          {
            guard: ({ event }) =>
              (event.error as Error).message === "Missing order item",
            target: "Exception.MissingItem",
          },
          {
            guard: ({ event }) =>
              (event.error as Error).message === "Missing order quantity",
            target: "Exception.MissingQuantity",
          },
        ],
      },
    },
    ApplyOrder: {
      invoke: {
        src: "applyOrderWorkflowId",
        onDone: "End",
      },
    },
    End: {
      type: "final",
    },
    Exception: {
      initial: "MissingId",
      states: {
        MissingId: {
          invoke: {
            src: "handleMissingIdExceptionWorkflow",
            onDone: "End",
          },
        },
        MissingItem: {
          invoke: {
            src: "handleMissingItemExceptionWorkflow",
            onDone: "End",
          },
        },
        MissingQuantity: {
          invoke: {
            src: "handleMissingQuantityExceptionWorkflow",
            onDone: "End",
          },
        },
        End: {
          type: "final",
        },
      },
      onDone: "End",
    },
  },
});

describe("Provision order workflow", () => {
  it("Will complete successfully", { timeout: 20_000 }, async () => {
    const wf = xstate("workflow", workflow);

    using actor = await createRestateTestActor<SnapshotFrom<typeof workflow>>({
      machine: wf,
      input: {
        order: {
          id: "", // Intentionally missing id to trigger exception
          item: "laptop",
          quantity: "10",
        },
      },
    });

    await eventually(() => actor.snapshot()).toMatchObject({
      status: "error",
      value: "ProvisionOrder",
    });
  });
});
