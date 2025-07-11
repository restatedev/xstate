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
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable no-constant-condition */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { xstate, fromPromise } from "../src/public_api.js";
import { describe, it, expect } from "vitest";
import { eventually, runMachine } from "./runner.js";

import { createMachine, assign } from "xstate";

interface Bid {
  carid: string;
  amount: number;
  bidder: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

// https://github.com/serverlessworkflow/specification/tree/main/examples#handle-car-auction-bids-example
export const workflow = createMachine(
  {
    id: "handleCarAuctionBid",
    description: "Store a single bid whole the car auction is active",
    initial: "StoreCarAuctionBid",
    types: {} as {
      context: {
        bids: Bid[];
      };
      events: {
        type: "CarBidEvent";
        bid: Bid;
      };
    },
    context: {
      bids: [],
    },
    states: {
      StoreCarAuctionBid: {
        on: {
          CarBidEvent: {
            actions: assign({
              bids: ({ context, event }) => [...context.bids, event.bid],
            }),
          },
        },
        after: {
          BiddingDelay: "BiddingEnded",
        },
      },
      BiddingEnded: {
        type: "final",
      },
    },
    output: ({ context }) => ({
      // highest bid
      winningBid: context.bids.reduce((prev, current) =>
        prev.amount > current.amount ? prev : current
      ),
    }),
  },
  {
    delays: {
      BiddingDelay: 3000,
    },
  }
);

describe("A car auction bidding workflow", () => {
  it("Will complete successfully", { timeout: 20_000 }, async () => {
    const wf = xstate("workflow", workflow);

    using actor = await runMachine<any>({
      machine: wf,
    });

    await actor.send({
      type: "CarBidEvent",
      bid: {
        carid: "car123",
        amount: 3000,
        bidder: {
          id: "xyz",
          firstName: "John",
          lastName: "Wayne",
        },
      },
    });

    await actor.send({
      type: "CarBidEvent",
      bid: {
        carid: "car123",
        amount: 4000,
        bidder: {
          id: "abc",
          firstName: "Jane",
          lastName: "Doe",
        },
      },
    });

    await eventually(async () => {
      const snapshot = await actor.snapshot();
      console.log(snapshot);
      expect(snapshot?.status).toStrictEqual("done");
      expect(snapshot?.value).toStrictEqual("BiddingEnded");

      // TODO: figure out why output is not available in the snapshot
      expect(snapshot?.output).toStrictEqual({
        winningBid: {
          carid: "car123",
          amount: 4000,
          bidder: {
            id: "abc",
            firstName: "Jane",
            lastName: "Doe",
          },
        },
      });
    });
  });
});
