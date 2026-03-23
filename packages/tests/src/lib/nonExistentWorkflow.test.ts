/*
 * Copyright (c) 2023-2026 - Restate Software, Inc., Restate GmbH
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
import { describe, it, expect, afterAll } from "vitest";
import {
  RestateContainer,
  RestateTestEnvironment,
} from "@restatedev/restate-sdk-testcontainers";
import * as clients from "@restatedev/restate-sdk-clients";
import type { MachineApi } from "@restatedev/xstate-test";

const simpleMachine = createMachine({
  id: "simplev1",
  initial: "idle",
  states: {
    idle: {
      on: { START: "running" },
    },
    running: {},
  },
});

describe("Non-existent workflow ID", () => {
  const machine = xstate("simple", simpleMachine);
  let env: RestateTestEnvironment | undefined;
  let client: clients.IngressClient<MachineApi>;

  afterAll(async () => {
    if (env) {
      await env.stop();
    }
  });

  it(
    "Should return 404 when calling snapshot on a non-existent workflow ID",
    { timeout: 30_000 },
    async () => {
      env = await RestateTestEnvironment.start({ services: [machine] }, () =>
        new RestateContainer().withEnvironment({
          RESTATE_DEFAULT_NUM_PARTITIONS: "2",
          RESTATE_ROCKSDB_TOTAL_MEMORY_SIZE: "64 MB",
          RESTATE_DISABLE_TELEMETRY: "true",
        }),
      );

      const rs = clients.connect({ url: env.baseUrl() });
      client = rs.objectClient<MachineApi>(machine, "non-existent-id");

      await expect(() => client.snapshot()).rejects.toThrow(
        "No state machine found for this workflow ID. Call 'create' first.",
      );
    },
  );

  it(
    "Should return 404 when calling send on a non-existent workflow ID",
    { timeout: 30_000 },
    async () => {
      await expect(() =>
        client.send({ event: { type: "START" } }),
      ).rejects.toThrow(
        "No state machine found for this workflow ID. Call 'create' first.",
      );
    },
  );

  it(
    "Should succeed after calling create first",
    { timeout: 30_000 },
    async () => {
      await client.create({ input: {} });

      const snap = await client.snapshot();
      expect(snap).toMatchObject({
        status: "active",
        value: "idle",
      });

      await client.send({ event: { type: "START" } });

      const snap2 = await client.snapshot();
      expect(snap2).toMatchObject({
        status: "active",
        value: "running",
      });
    },
  );
});
