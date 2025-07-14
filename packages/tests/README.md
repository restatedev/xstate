# `@restatedev/xstate-test`

Test utility for Restate + XState.

## Usage

```ts
import { createMachine, assign } from "xstate";
import { xstate } from "@restatedev/xstate";
import { createRestateTestActor } from "@restatedev/xstate-test";

const machine = xstate(
  "counter",
  createMachine({
    context: { count: 0 },
    on: {
      inc: { ... },
    },
  }),
);

it("example test", async () => {
  using actor = await createRestateTestActor({ machine });
  await actor.send({ type: "inc" });
  const snap = await actor.snapshot();
  expect(snap.context.count).toBe(1);
});
```

## API

- `createRestateTestActor({ machine })`: Starts the actor.
- `actor.send(event)`: Sends events.
- `actor.snapshot()`: Gets current state.
