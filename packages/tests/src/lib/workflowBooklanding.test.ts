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

import { createMachine, assign } from "xstate";
import { eventually } from "./eventually.js";

async function delay(ms: number, errorProbability: number = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (Math.random() < errorProbability) {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject({ type: "ServiceNotAvailable" });
      } else {
        resolve();
      }
    }, ms);
  });
}

interface Lender {
  name: string;
  address: string;
  phone: string;
}

// https://github.com/serverlessworkflow/specification/blob/main/examples/README.md#book-lending
export const workflow = createMachine(
  {
    types: {} as {
      context: {
        book: {
          title: string;
          id: string;
          status: "onloan" | "available" | "unknown";
        } | null;
        lender: Lender | null;
      };
      events:
        | {
            type: "bookLendingRequest";
            book: {
              title: string;
              id: string;
            };
            lender: Lender;
          }
        | {
            type: "holdBook";
          }
        | {
            type: "declineBookhold";
          };
    },
    initial: "Book Lending Request",
    context: {
      book: null,
      lender: null,
    },
    states: {
      "Book Lending Request": {
        on: {
          bookLendingRequest: {
            target: "Get Book Status",
            actions: assign({
              book: ({ event }) => ({
                ...event.book,
                status: "unknown" as const,
              }),
            }),
          },
        },
      },
      "Get Book Status": {
        invoke: {
          src: "Get status for book",
          input: ({ context }) => ({
            bookid: context.book?.id,
          }),
          onDone: {
            target: "Book Status Decision",
            actions: assign({
              // TODO: Fix typing issue
              book: ({ context, event }) => ({
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                ...context.book!,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                status: event.output.status,
              }),
            }),
          },
        },
      },
      "Book Status Decision": {
        always: [
          {
            guard: ({ context }) => context.book?.status === "onloan",
            target: "Report Status To Lender",
          },
          {
            guard: ({ context }) => context.book?.status === "available",
            target: "Check Out Book",
          },
          {
            target: "End",
          },
        ],
      },
      "Report Status To Lender": {
        invoke: {
          src: "Send status to lender",
          input: ({ context }) => ({
            bookid: context.book?.id,
            message: `Book ${String(context.book?.title)} is already on loan`,
          }),
          onDone: {
            target: "Wait for Lender response",
          },
        },
      },
      "Wait for Lender response": {
        on: {
          holdBook: {
            target: "Request Hold",
          },
          declineBookhold: {
            target: "Cancel Request",
          },
        },
      },
      "Request Hold": {
        invoke: {
          src: "Request hold for lender",
          input: ({ context }) => ({
            bookid: context.book?.id,
            lender: context.lender,
          }),
          onDone: {
            target: "Sleep two weeks",
          },
        },
      },
      "Cancel Request": {
        invoke: {
          src: "Cancel hold request for lender",
          input: ({ context }) => ({
            bookid: context.book?.id,
            lender: context.lender,
          }),
          onDone: {
            target: "End",
          },
        },
      },
      "Sleep two weeks": {
        after: {
          PT2W: {
            target: "Get Book Status",
          },
        },
      },
      "Check Out Book": {
        initial: "Checking out book",
        states: {
          "Checking out book": {
            invoke: {
              src: "Check out book with id",
              input: ({ context }) => ({
                bookid: context.book?.id,
              }),
              onDone: {
                target: "Notifying Lender",
              },
            },
          },
          "Notifying Lender": {
            invoke: {
              src: "Notify Lender for checkout",
              input: ({ context }) => ({
                bookid: context.book?.id,
                lender: context.lender,
              }),
              onDone: {
                target: "End",
              },
            },
          },
          End: {
            type: "final",
          },
        },
      },
      End: {
        type: "final",
      },
    },
  },
  {
    actors: {
      "Get status for book": fromPromise(async ({ input }) => {
        console.log("Starting Get status for book", input);
        await delay(1000);

        return {
          status: "available",
        };
      }),
      "Send status to lender": fromPromise(async ({ input }) => {
        console.log("Starting Send status to lender", input);
        await delay(1000);
      }),
      "Request hold for lender": fromPromise(
        async ({
          input,
        }: {
          input: {
            bookid: string;
            lender: Lender;
          };
        }) => {
          console.log("Starting Request hold for lender", input);
          await delay(1000);
        },
      ),
      "Cancel hold request for lender": fromPromise(
        async ({
          input,
        }: {
          input: {
            bookid: string;
            lender: Lender;
          };
        }) => {
          console.log("Starting Cancel hold request for lender", input);
          await delay(1000);
        },
      ),
      "Check out book with id": fromPromise(
        async ({
          input,
        }: {
          input: {
            bookid: string;
          };
        }) => {
          console.log("Starting Check out book with id", input);
          await delay(1000);
        },
      ),
      "Notify Lender for checkout": fromPromise(
        async ({
          input,
        }: {
          input: {
            bookid: string;
            lender: Lender;
          };
        }) => {
          console.log("Starting Notify Lender for checkout", input);
          await delay(1000);
        },
      ),
    },
  },
);

describe("An book landing workflow", () => {
  it("Will complete successfully", { timeout: 20_000 }, async () => {
    const wf = xstate("workflow", workflow);

    using actor = await createRestateTestActor<
      { value?: { "Check Out Book": string } } | undefined
    >({
      machine: wf,
    });

    await actor.send({
      type: "bookLendingRequest",
      book: {
        title: "The Hitchhiker's Guide to the Galaxy",
        id: "42",
      },
      lender: {
        name: "John Doe",
        address: " ... ",
        phone: " ... ",
      },
    });

    await eventually(() => actor.snapshot()).toMatchObject({
      value: { "Check Out Book": "End" },
    });
  });
});
