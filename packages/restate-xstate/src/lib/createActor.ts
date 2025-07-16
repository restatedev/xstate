import type {
  ActorOptions,
  AnyStateMachine,
  InteropSubscribable,
  Snapshot,
  Subscription,
} from "xstate";
import { toObserver, createActor as createXActor } from "xstate";
import * as restate from "@restatedev/restate-sdk";
import type {
  ActorEventSender,
  ActorRefEventSender,
  State,
  XStateApi,
} from "./types.js";
import { createSystem } from "./system.js";

export async function createActor<TLogic extends AnyStateMachine>(
  ctx: restate.ObjectContext<State>,
  api: XStateApi<string, TLogic>,
  systemName: string,
  version: string,
  logic: TLogic,
  options?: ActorOptions<TLogic>,
): Promise<ActorEventSender<TLogic>> {
  const system = await createSystem(ctx, api, systemName, version);
  const snapshot = (await ctx.get("snapshot")) ?? undefined;

  const parent: ActorRefEventSender = {
    id: "fakeRoot",
    sessionId: "fakeRoot",
    send: () => {},
    _send: () => {},
    start: () => {},
    getSnapshot: (): null => {
      return null;
    }, // TODO
    getPersistedSnapshot: (): Snapshot<unknown> => {
      return {
        status: "active",
        output: undefined,
        error: undefined,
      };
    }, // TODO
    stop: () => {}, // TODO
    on: () => {
      return { unsubscribe: () => {} };
    }, // TODO
    system,
    src: "fakeRoot",
    subscribe: (): Subscription => {
      return {
        unsubscribe() {},
      };
    },
    [Symbol.observable]: (): InteropSubscribable<unknown> => {
      return {
        subscribe(): Subscription {
          return {
            unsubscribe() {},
          };
        },
      };
    },
  };

  if (options?.inspect) {
    // Always inspect at the system-level
    system.inspect(toObserver(options.inspect));
  }

  const actor = createXActor(logic, {
    id: ctx.key,
    ...options,
    parent,
    snapshot,
  });

  return actor as ActorEventSender<TLogic>;
}
