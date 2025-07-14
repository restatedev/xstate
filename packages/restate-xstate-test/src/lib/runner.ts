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

import {
  RestateContainer,
  RestateTestEnvironment,
} from "@restatedev/restate-sdk-testcontainers";
import type { VirtualObjectDefinition } from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { type AnyEventObject } from "xstate";

export type MachineApi = {
  create: (context: unknown, request?: { input: unknown }) => Promise<unknown>;

  send: (context: unknown, args: { event: AnyEventObject }) => Promise<unknown>;

  snapshot: (context: unknown) => Promise<unknown>;
};

export type RunMachineOptions = {
  machine: VirtualObjectDefinition<string, MachineApi>;
  key?: string;
  input?: unknown;
};

export type RunningMachine<SnapshotType> = {
  send: (event: AnyEventObject) => Promise<SnapshotType>;
  snapshot(): Promise<SnapshotType>;
  [Symbol.dispose](): void;
};

export async function createRestateTestActor<SnapshotType>(
  opts: RunMachineOptions,
): Promise<RunningMachine<SnapshotType>> {
  const env = await RestateTestEnvironment.start(
    (restateServer) => {
      restateServer.bind(opts.machine);
    },
    () =>
      new RestateContainer().withEnvironment({
        RESTATE_DEFAULT_NUM_PARTITIONS: "2",
        RESTATE_ROCKSDB_TOTAL_MEMORY_SIZE: "64 MB",
        RESTATE_DISABLE_TELEMETRY: "true",
      }),
  );

  try {
    const rs = clients.connect({
      url: env.baseUrl(),
    });
    const client = rs.objectClient(opts.machine, opts.key ?? "default");
    await client.create({ input: opts.input ?? {} });
    return {
      send: async (event: AnyEventObject) => {
        return (await client.send({ event })) as SnapshotType;
      },

      snapshot: async () => {
        return (await client.snapshot()) as SnapshotType;
      },

      [Symbol.dispose]: () => {
        env.stop().catch((err: unknown) => {
          console.error("Error stopping environment:", err);
        });
      },
    };
  } catch (error) {
    if (typeof env !== "undefined") {
      await env.stop();
    }
    throw error;
  }
}
