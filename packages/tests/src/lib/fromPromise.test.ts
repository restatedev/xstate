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
import { describe, expect, it, vi } from "vitest";
import { createRestateTestActor } from "@restatedev/xstate-test";

import { setup } from "xstate";
import { eventually } from "./eventually.js";
import { TerminalError } from "@restatedev/restate-sdk";

// from: https://raw.githubusercontent.com/statelyai/xstate/refs/heads/main/examples/workflow-async-function/main.ts

describe("A fromPromise based state machine", () => {
  const machineFactory = (sendEmail: (customer: string) => Promise<void>) =>
    setup({
      types: {
        input: {} as {
          customer: string;
        },
        context: {} as {
          customer: string;
        },
      },
      actors: {
        sendEmail: fromPromise<undefined, { customer: string }>(
          async ({ input, ctx }) => {
            await ctx.run("Sending email to", async () => {
              await sendEmail(input.customer);
            });
          },
        ),
      },
    }).createMachine({
      id: "async-function-invocation",
      initial: "Send email",
      context: ({ input }) => ({
        customer: input.customer,
      }),
      states: {
        "Send email": {
          invoke: {
            src: "sendEmail",
            input: ({ context }) => ({
              customer: context.customer,
            }),
            onDone: "Email sent",
            onError: "Failed",
          },
        },
        "Email sent": {
          type: "final",
        },
        Failed: {
          type: "final",
        },
      },
    });

  it(
    "should run the promise actor with restate context",
    { timeout: 20_000 },
    async () => {
      const sendEmail = vi.fn<(customer: string) => Promise<void>>();
      const actorDefinition = xstate(
        "machine-success",
        machineFactory(sendEmail),
      );

      using actor = await createRestateTestActor<
        { status?: string } | undefined
      >({
        machine: actorDefinition,
        input: { customer: "bob@mop.com" },
      });

      await vi.waitFor(() => {
        expect(sendEmail).toHaveBeenCalledWith("bob@mop.com");
      });

      await eventually(() => actor.snapshot()).toMatchObject({
        status: "done",
        value: "Email sent",
      });
    },
  );

  it(
    "should handle handle retryable error in fromPromise",
    { timeout: 20_000 },
    async () => {
      const sendEmail = vi
        .fn<(customer: string) => Promise<void>>()
        .mockRejectedValueOnce(new Error("Fail to send email"))
        .mockRejectedValueOnce(new Error("Fail to send email"))
        .mockResolvedValue(undefined);

      const actorDefinition = xstate(
        "machine-retryable",
        machineFactory(sendEmail),
      );
      using actor = await createRestateTestActor<
        { status?: string } | undefined
      >({
        machine: actorDefinition,
        input: { customer: "bob@mop.com" },
      });

      await vi.waitFor(() => {
        expect(sendEmail).toHaveBeenCalledWith("bob@mop.com");
      });
      await vi.waitFor(() => {
        expect(sendEmail).toHaveBeenCalledTimes(3);
      });

      await eventually(() => actor.snapshot()).toMatchObject({
        status: "done",
        value: "Email sent",
      });
    },
  );

  it(
    "should handle handle terminal error in fromPromise",
    { timeout: 20_000 },
    async () => {
      const sendEmail = vi
        .fn<(customer: string) => Promise<void>>()
        .mockRejectedValueOnce(new TerminalError("Fail to send email"));
      const actorDefinition = xstate(
        "machine-terminal",
        machineFactory(sendEmail),
      );

      using actor = await createRestateTestActor<
        { status?: string } | undefined
      >({
        machine: actorDefinition,
        input: { customer: "bob@mop.com" },
      });

      await vi.waitFor(() => {
        expect(sendEmail).toHaveBeenCalledWith("bob@mop.com");
      });
      await vi.waitFor(() => {
        expect(sendEmail).toHaveBeenCalledTimes(1);
      });

      await eventually(() => actor.snapshot()).toMatchObject({
        status: "done",
        value: "Failed",
      });
    },
  );
});
