/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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

import { setup, assign, type SnapshotFrom } from "xstate";
import { eventually } from "./eventually.js";

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

interface PatientInfo {
  name: string;
  pet: string;
  reason: string;
}

// https://github.com/serverlessworkflow/specification/tree/main/examples#event-based-service-invocation
export const workflow = setup({
  actors: {
    MakeAppointmentAction: fromPromise(
      async ({ input }: { input: { patientInfo: PatientInfo } }) => {
        console.log("Making vet appointment for", input.patientInfo);
        await delay(2000);

        const appointmentInfo = {
          appointmentId: "1234",
          appointmentDate: new Date().toISOString(),
        };

        console.log("Vet appointment made", appointmentInfo);
        return {
          appointmentInfo,
        };
      },
    ),
  },
}).createMachine({
  id: "VetAppointmentWorkflow",
  types: {} as {
    context: {
      patientInfo: PatientInfo | null;
      appointmentInfo: {
        appointmentId: string;
        appointmentDate: string;
      } | null;
    };
    events: {
      type: "MakeVetAppointment";
      patientInfo: {
        name: string;
        pet: string;
        reason: string;
      };
    };
  },
  initial: "Idle",
  context: {
    patientInfo: null,
    appointmentInfo: null,
  } as {
    patientInfo: PatientInfo | null;
    appointmentInfo: {
      appointmentId: string;
      appointmentDate: string;
    } | null;
  },
  states: {
    Idle: {
      on: {
        MakeVetAppointment: {
          target: "MakeVetAppointmentState",
          actions: assign({
            patientInfo: ({ event }) => event.patientInfo,
          }),
        },
      },
    },
    MakeVetAppointmentState: {
      invoke: {
        src: "MakeAppointmentAction",
        input: ({ context }) => ({
          patientInfo: context.patientInfo,
        }),
        onDone: {
          target: "Idle",
          actions: assign({
            appointmentInfo: ({ event }) => event.output,
          }),
        },
      },
    },
  },
});

describe("An event based workflow", () => {
  it("Will complete successfully", { timeout: 20_000 }, async () => {
    const wf = xstate("workflow", workflow);

    using actor = await createRestateTestActor<SnapshotFrom<typeof workflow>>({
      machine: wf,
      input: {
        person: { name: "Jenny" },
      },
    });

    await actor.send({
      type: "MakeVetAppointment",
      patientInfo: {
        name: "Jenny",
        pet: "Ato",
        reason: "Annual checkup",
      },
    });

    await eventually(
      async () =>
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        (await actor.snapshot()).context.appointmentInfo.appointmentInfo
          ?.appointmentId,
    ).toStrictEqual("1234");
  });
});
