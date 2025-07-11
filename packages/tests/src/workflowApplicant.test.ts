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
import { describe, it, expect } from "vitest";
import { eventually, runMachine } from "./runner.js";

import { setup } from "xstate";

interface Applicant {
  fname: string;
  lname: string;
  age: number;
  email: string;
}

// https://github.com/serverlessworkflow/specification/tree/main/examples#applicant-request-decision-example
export const workflow = setup({
  types: {} as {
    context: {
      applicant: Applicant;
    };
    input: {
      applicant: Applicant;
    };
  },
  actors: {
    startApplicationWorkflowId: fromPromise(async () => {
      console.log("startApplicationWorkflowId workflow started");

      await new Promise((resolve) => setTimeout(resolve, 1000));
      console.log("startApplicationWorkflowId workflow completed");
    }),
    sendRejectionEmailFunction: fromPromise(async () => {
      console.log("sendRejectionEmailFunction workflow started");

      await new Promise((resolve) => setTimeout(resolve, 1000));
      console.log("sendRejectionEmailFunction workflow completed");
    }),
  },
  guards: {
    isOver18: ({ context }) => context.applicant.age >= 18,
  },
}).createMachine({
  id: "applicantrequest",

  initial: "CheckApplication",
  context: ({ input }) => ({
    applicant: input.applicant,
  }),
  states: {
    CheckApplication: {
      on: {
        Submit: [
          {
            target: "StartApplication",
            guard: "isOver18",
            reenter: false,
          },
          {
            target: "RejectApplication",
            reenter: false,
          },
        ],
      },
    },
    StartApplication: {
      invoke: {
        src: "startApplicationWorkflowId",
        onDone: "End",
        onError: "RejectApplication",
      },
    },
    RejectApplication: {
      invoke: {
        src: "sendRejectionEmailFunction",
        input: ({ context }) => ({
          applicant: context.applicant,
        }),
        onDone: "End",
      },
    },
    End: {
      type: "final",
    },
  },
});

describe("An applicant workflow", () => {
  it(
    "Will complete the workflow successfully",
    { timeout: 30_000 },
    async () => {
      const wf = xstate("workflow", workflow);

      using actor = await runMachine<{ value?: string } | undefined>({
        machine: wf,
        input: {
          applicant: {
            fname: "John",
            lname: "Stockton",
            age: 22,
            email: "js@something.com",
          },
        },
      });

      await actor.send({
        type: "Submit",
      });

      await eventually(async () => {
        const snapshot = await actor.snapshot();
        expect(snapshot?.value).toStrictEqual("End");
      });
    },
  );
});
