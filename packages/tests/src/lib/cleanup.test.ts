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
import { createMachine } from "xstate";
import { describe, it, expect } from "vitest";
import { createRestateTestActor } from "@restatedev/xstate-test";
import { wait } from "./eventually.js";

const lifeCycleTrackerMachine = createMachine({
  id: "task",
  initial: "idle",
  states: {
    idle: {
      on: { START: "inProgress" },
    },
    inProgress: {
      on: { COMPLETE: "done" },
    },
    done: {
      type: "final",
    },
  },
});

describe("Cleanup", () => {
  it(
    "Should not cleanup if finalStateTTL is not set",
    { timeout: 20_000 },
    async () => {
      const lifeCycleTracker = xstate(
        "lifeCycleTracker",
        lifeCycleTrackerMachine,
      );

      using machine = await createRestateTestActor({
        machine: lifeCycleTracker,
      });

      await machine.send({ type: "START" });
      expect(await machine.snapshot()).toMatchObject({
        status: "active",
        value: "inProgress",
      });

      await machine.send({ type: "COMPLETE" });
      expect(await machine.snapshot()).toMatchObject({
        status: "done",
        value: "done",
      });
      await wait(100);
      expect(await machine.snapshot()).toMatchObject({
        status: "done",
        value: "done",
      });
    },
  );

  it(
    "Should cleanup if finalStateTTL is set",
    { timeout: 20_000 },
    async () => {
      const lifeCycleTracker = xstate(
        "lifeCycleTracker",
        lifeCycleTrackerMachine,
        { finalStateTTL: 100 },
      );

      using machine = await createRestateTestActor({
        machine: lifeCycleTracker,
      });

      await machine.send({ type: "START" });
      expect(await machine.snapshot()).toMatchObject({
        status: "active",
        value: "inProgress",
      });

      await machine.send({ type: "COMPLETE" });
      expect(await machine.snapshot()).toMatchObject({
        status: "done",
        value: "done",
      });
      await wait(100);
      await expect(() => machine.snapshot()).rejects.toThrow(
        "The state machine has been disposed after reaching it's final state",
      );

      /** Should not accept any events after termination */
      await expect(() => machine.send({ type: "START" })).rejects.toThrow(
        "The state machine has been disposed after reaching it's final state",
      );
    },
  );

  it(
    "Should cleanup if on entry reaches final state",
    { timeout: 20_000 },
    async () => {
      const lifeCycleTracker = xstate(
        "lifeCycleTracker",
        createMachine({
          id: "task",
          initial: "done",
          states: {
            done: {
              type: "final",
            },
          },
        }),
        { finalStateTTL: 100 },
      );

      using machine = await createRestateTestActor({
        machine: lifeCycleTracker,
      });

      expect(await machine.snapshot()).toMatchObject({
        status: "done",
        value: "done",
      });

      await wait(100);
      await expect(() => machine.snapshot()).rejects.toThrow(
        "The state machine has been disposed after reaching it's final state",
      );
    },
  );
});
