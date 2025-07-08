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

// given an xstate generated machine and set of events, produce the latest snapshot.
export async function runMachine<ReturnType>(
  xs: VirtualObjectDefinition<
    string,
    {
      create: (context: unknown) => Promise<unknown>;
      send: (
        context: unknown,
        args: { event: AnyEventObject }
      ) => Promise<unknown>;
    }
  >,
  key: string,
  events: AnyEventObject[]
): Promise<ReturnType> {
  let env: RestateTestEnvironment | undefined = undefined;
  try {
    env = await RestateTestEnvironment.start(
      (restateServer) => {
        restateServer.bind(xs);
      },
      () =>
        new RestateContainer().withEnvironment({
          RESTATE_DEFAULT_NUM_PARTITIONS: "2",
          RESTATE_ROCKSDB_TOTAL_MEMORY_SIZE: "64 MB",
          RESTATE_DISABLE_TELEMETRY: "true",
        })
    );

    const rs = clients.connect({ url: env.baseUrl() });
    const client = rs.objectClient(xs, key);

    let res = await client.create();
    for (const event of events) {
      res = await client.send({ event });
    }

    return res as ReturnType;
  } finally {
    if (env !== undefined) {
      await env.stop();
    }
  }
}
