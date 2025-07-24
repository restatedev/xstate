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
import { fromPromise } from "@restatedev/xstate/promise";
import { describe, expect, it, vi } from "vitest";
import { createRestateTestActor } from "@restatedev/xstate-test";

import { assign, cancel, sendTo, setup } from "xstate";
import { eventually, wait } from "./eventually.js";

type MachineEvents = { type: "START_DELAYED" } | { type: "CANCEL" };

type TaskEvents = { type: "START" };

describe("Scheduled events", () => {
  const machineFactory = (executor: () => Promise<void>) => {
    const taskMachine = setup({
      types: {
        events: {} as TaskEvents,
      },
      actors: {
        execute: fromPromise(async ({ ctx }) => {
          await ctx.run("Execute", async () => {
            await executor();
          });
        }),
      },
    }).createMachine({
      id: "task",
      initial: "idle",

      states: {
        idle: {
          on: {
            START: {
              target: "running",
            },
          },
        },
        running: {
          invoke: {
            onDone: "finished",
            src: "execute",
          },
        },
        finished: {
          type: "final",
        },
      },
    });
    return setup({
      actors: {
        task: taskMachine,
      },
      types: {
        events: {} as MachineEvents,
      },
      actions: {
        scheduleStart: sendTo(
          "task",
          { type: "START" },
          { delay: 100, id: "startDelay" },
        ),
        cancelStart: cancel("startDelay"),
      },
    }).createMachine({
      id: "delayedStarter",
      initial: "ready",
      context: {
        taskRef: null,
      },
      states: {
        ready: {
          entry: assign({
            taskRef: ({ spawn }) => spawn("task", { id: "task" }),
          }),
          on: {
            START_DELAYED: {
              actions: "scheduleStart",
              target: "pending",
            },
          },
        },
        pending: {
          on: {
            CANCEL: {
              actions: "cancelStart",
              target: "ready",
            },
          },
        },
      },
    });
  };

  it("should run delayed actions", { timeout: 20_000 }, async () => {
    const executor = vi.fn<() => Promise<void>>();
    const actorDefinition = xstate("machine-success", machineFactory(executor));

    using actor = await createRestateTestActor<{ status?: string } | undefined>(
      {
        machine: actorDefinition,
      },
    );
    await actor.send({ type: "START_DELAYED" });
    await eventually(() => actor.snapshot()).toMatchObject({
      status: "active",
      value: "pending",
    });

    await wait(50);
    expect(executor).not.toHaveBeenCalled();
    await wait(50);

    await vi.waitFor(() => {
      expect(executor).toHaveBeenCalledTimes(1);
    });
  });

  it("should cancel delayed actions", { timeout: 20_000 }, async () => {
    const executor = vi.fn<() => Promise<void>>();
    const actorDefinition = xstate("machine-cancel", machineFactory(executor));
    expect(executor).not.toHaveBeenCalled();

    using actor = await createRestateTestActor<{ status?: string } | undefined>(
      {
        machine: actorDefinition,
      },
    );
    await actor.send({ type: "START_DELAYED" });
    await eventually(() => actor.snapshot()).toMatchObject({
      status: "active",
      value: "pending",
    });

    await wait(50);
    expect(executor).not.toHaveBeenCalled();
    await actor.send({ type: "CANCEL" });
    await wait(50);

    expect(executor).not.toHaveBeenCalled();
  });
});
