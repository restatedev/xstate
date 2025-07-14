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

import { setup, assign } from "xstate";
import { eventually } from "./eventually.js";

const prompt = (_question: string) => Promise.resolve("bob");

const onboardingWorkflow = setup({
  actors: {
    prompt: fromPromise(async ({ input }: { input: { question: string } }) => {
      const response = await prompt(input.question);
      return {
        response,
      };
    }),
  },
}).createMachine({
  id: "onboarding",
  initial: "Welcome",
  context: {
    name: undefined,
  },
  states: {
    Welcome: {
      invoke: {
        src: "prompt",
        input: {
          question: "What is your name?",
        },
        onDone: {
          target: "Personalize",
          actions: assign({
            name: ({ event }) => event.output.response,
          }),
        },
      },
    },
    Personalize: {
      invoke: {
        src: "prompt",
        input: ({ context }) => ({
          question: `Welcome ${String(context.name)}, press enter to finish the onboarding process`,
        }),
        onDone: "Completed",
      },
    },
    Completed: {
      type: "final",
    },
  },
});

export const workflow = setup({
  actors: {
    onboarding: onboardingWorkflow,
  },
}).createMachine({
  id: "async-function-invocation",
  initial: "Onboard",
  states: {
    Onboard: {
      invoke: {
        src: "onboarding",
        onDone: "Onboarded",
      },
    },
    Onboarded: {
      type: "final",
    },
  },
});

describe("An onboarding workflow", () => {
  it("Will complete successfully", { timeout: 20_000 }, async () => {
    const wf = xstate("workflow", workflow);

    using actor = await createRestateTestActor<{ value?: string } | undefined>({
      machine: wf,
    });

    await actor.send({
      type: "Submit",
    });

    await eventually(() => actor.snapshot()).toMatchObject({
      value: "Onboarded",
    });
  });
});
