/*
 * Copyright (c) 2023 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate Examples for the Node.js/TypeScript SDK,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in the file LICENSE
 * in the root directory of this repository or package or at
 * https://github.com/restatedev/examples/blob/main/LICENSE
 */

import * as restate from "@restatedev/restate-sdk";
import { xstate } from "@restatedev/xstate";
import { assign, createMachine } from "xstate";

const counterv1 = createMachine({
  id: "counterv1",
  context: {
    count: 0,
  },
  on: {
    increment: {
      actions: assign({
        count: ({ context }) => context.count + 1,
      }),
    },
    decrement: {
      actions: assign({
        count: ({ context }) => context.count - 1,
      }),
    },
  },
});

// v2 is incompatible with the state of v1 counters so a new version is used to allow it to be used only for new machines
const counterv2 = createMachine({
  id: "counterv2",
  context: {
    total: 0,
  },
  on: {
    increment: {
      actions: assign({
        total: ({ context }) => context.total + 1,
      }),
    },
    decrement: {
      actions: assign({
        total: ({ context }) => context.total - 1,
      }),
    },
  },
});

await restate
  .endpoint()
  .bind(
    xstate("counter", counterv2, {
      versions: {
        latest: "counterv2",
        previous: { counterv1 },
      },
    })
  )
  .listen();
