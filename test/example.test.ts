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

import { xstate } from "../src/public_api.js";
import { createMachine, assign } from "xstate";
import { describe, it, expect } from "vitest";
import { runMachine } from "./runner.js";

const countMachine = createMachine({
  id: "counterv1",
  context: {
    count: 0,
  },
  on: {
    inc: {
      actions: assign({
        count: ({ context }) => context.count + 1,
      }),
    },
    dec: {
      actions: assign({
        count: ({ context }) => context.count - 1,
      }),
    },
  },
});

describe("Simple count machine", () => {
  it(
    "Will respond to different count events",
    { timeout: 20_000 },
    async () => {
      const counter = xstate("counter", countMachine);

      const snapshot = await runMachine<{ context: { count: number } }>(
        counter,
        "foo",
        [{ type: "inc" }, { type: "inc" }, { type: "dec" }]
      );

      expect(snapshot.context.count).toBe(1);
    }
  );
});
