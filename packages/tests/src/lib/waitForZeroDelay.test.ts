/*
 * Copyright (c) 2023-2024 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 */

import { xstate } from "@restatedev/xstate";
import { createRestateTestActor } from "@restatedev/xstate-test";
import { setup, type SnapshotFrom } from "xstate";
import { describe, expect, it } from "vitest";

const machine = setup({
  types: {
    events: {} as { type: "START" },
  },
}).createMachine({
  id: "wait-for-zero-delay",
  initial: "A",
  states: {
    A: {
      on: {
        START: "B",
      },
    },
    B: {
      tags: ["B"],
      after: {
        0: "C",
      },
    },
    C: {
      type: "final",
    },
  },
});

describe("event-triggered waitFor with a zero-delay transition", () => {
  it(
    "subscribes before its event moves the machine through B",
    { timeout: 40_000 },
    async () => {
      const actorDefinition = xstate("wait-for-zero-delay", machine);

      using actor = await createRestateTestActor<SnapshotFrom<typeof machine>>(
        {
          machine: actorDefinition,
        },
        { alwaysReplay: true, disableRetries: true },
      );

      await expect(
        actor.waitFor("hasTag:B", { type: "START" }, 30_000, "bobi"),
      ).resolves.toMatchObject({
        status: "active",
        value: "B",
      });
    },
  );
});
