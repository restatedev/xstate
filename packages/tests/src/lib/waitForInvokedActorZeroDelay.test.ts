/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 */

import { xstate } from "@restatedev/xstate";
import { fromPromise } from "@restatedev/xstate/promise";
import { createRestateTestActor } from "@restatedev/xstate-test";
import { assign, setup, type SnapshotFrom } from "xstate";
import { describe, expect, it } from "vitest";

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

interface Context {
  steps: string[];
  transactionPostingStatus?: string;
}

const actors = {
  approveTransaction: fromPromise(async () => {
    await sleep(200);
    await sleep(200);
    return { transactionPostingStatus: "APPROVED" };
  }),
  checkHolidayCalendar: fromPromise(async () => {
    await sleep(488);
    return {};
  }),
};

const machine = setup({
  types: {
    context: {} as Context,
    events: {} as { type: "APPROVE" },
  },
  actors,
}).createMachine({
  id: "wait-for-invoked-actor-zero-delay",
  initial: "modify_or_action_decision",
  context: { steps: [] },
  states: {
    modify_or_action_decision: {
      on: {
        APPROVE: { target: "approve_transaction" },
      },
    },
    approve_transaction: {
      invoke: {
        src: "approveTransaction",
        onDone: {
          target: "approved",
          actions: assign(({ context, event }) => ({
            ...event.output,
            steps: [...context.steps, "approve_transaction"],
          })),
        },
        onError: { target: "failed" },
      },
    },
    approved: {
      tags: ["ODSApproved"],
      entry: assign(({ context }) => ({
        steps: [...context.steps, "ods_approved"],
      })),
      after: {
        0: { target: "check_holiday_calendar" },
      },
    },
    check_holiday_calendar: {
      invoke: {
        src: "checkHolidayCalendar",
        onDone: { target: "complete" },
        onError: { target: "complete" },
      },
    },
    complete: { type: "final" },
    failed: { type: "final" },
  },
});

describe("event-triggered waitFor with invoked actors", () => {
  it(
    "resolves on the tagged state before its zero-delay transition",
    { timeout: 40_000 },
    async () => {
      const actorDefinition = xstate(
        "wait-for-invoked-actor-zero-delay",
        machine,
      );

      using actor = await createRestateTestActor<SnapshotFrom<typeof machine>>(
        { machine: actorDefinition },
        { alwaysReplay: true, disableRetries: true },
      );

      await expect(
        actor.waitFor(
          "hasTag:ODSApproved",
          { type: "APPROVE" },
          30_000,
          "wait-for-ods-approved",
        ),
      ).resolves.toMatchObject({
        status: "active",
        value: "approved",
        context: {
          transactionPostingStatus: "APPROVED",
          steps: ["approve_transaction", "ods_approved"],
        },
      });

      await expect(
        actor.waitFor("done", undefined, 30_000),
      ).resolves.toMatchObject({
        status: "done",
        value: "complete",
      });
    },
  );
});
