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
import { type VirtualObjectDefinition } from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { type AnyEventObject } from "xstate";

export type MachineApi = {
  create: (context: unknown, request?: { input: unknown }) => Promise<unknown>;

  send: (context: unknown, args: { event: AnyEventObject }) => Promise<unknown>;

  snapshot: (context: unknown) => Promise<unknown>;
};

export type AsyncEventGenerator<SnapshotType> = AsyncGenerator<
  AnyEventObject,
  void,
  SnapshotType
>;

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

export class RunningMachineImpl<SnapshotType>
  implements RunningMachine<SnapshotType>
{
  constructor(
    private readonly opts: RunMachineOptions,
    private env: RestateTestEnvironment,
  ) {}

  async send(event: AnyEventObject): Promise<SnapshotType> {
    const rs = clients.connect({ url: this.env.baseUrl() });
    const client = rs.objectClient(
      this.opts.machine,
      this.opts.key ?? "default",
    );
    return (await client.send({ event })) as SnapshotType;
  }

  async snapshot(): Promise<SnapshotType> {
    const rs = clients.connect({ url: this.env.baseUrl() });
    const client = rs.objectClient(
      this.opts.machine,
      this.opts.key ?? "default",
    );
    return (await client.snapshot()) as SnapshotType;
  }

  [Symbol.dispose](): void {
    if (this.env !== undefined) {
      this.env.stop().catch((err) => {
        console.error("Error stopping environment:", err);
      });
    }
  }
}

export async function runMachine<SnapshotType>(
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
    const rs = clients.connect({ url: env.baseUrl() });
    const client = rs.objectClient(opts.machine, opts.key ?? "default");
    await client.create({ input: opts.input ?? {} });
    return new RunningMachineImpl(opts, env);
  } catch (error) {
    if (env !== undefined) {
      await env.stop();
    }
    throw error;
  }
}
