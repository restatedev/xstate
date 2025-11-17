# Deploying a XState state machine on Restate

This repo shows how to integrate Restate deeply with
[XState](https://stately.ai/docs/xstate). The code in [src/lib.ts](./src/lib.ts)
converts an XState machine into a Restate virtual object, which stores the state
of the state machine, keyed on an identifier for this instance of the machine.
This service is called with every event that must be processed by the state machine.
XState machines are generally pure and are not async; side effects generally
happen through [Promise Actors](https://stately.ai/docs/promise-actors).
As such, this service should never block the machine, so other events can always be
processed. The provided Promise actor `fromPromise` should be used to handle
async operations, which will run in a shared virtual object handler so as to
avoid blocking the event loop.

The service is set up and managed automatically by interpreting the state
machine definition, and can be deployed as a Lambda or as a long-lived service.

In [`examples/auth/app.ts`](../examples/src/auth/app.ts) you will see an example of an XState machine
that uses cross-machine communication, delays, and Promise actors, all running in Restate.
Most XState machines should work out of the box, but this is still experimental, so
we haven't tested everything yet!

To try out this example:

```bash
# start a local Restate instance
restate-server
# start the service
npm run examples
# register the state machine service against restate
restate dep register http://localhost:9080

# create a state machine
curl http://localhost:8080/auth/myMachine/create
# watch the state
watch -n1 'curl -s http://localhost:8080/auth/myMachine/snapshot'
# kick off the machine
curl http://localhost:8080/auth/myMachine/send --json '{"event": {"type": "AUTH"}}'
# and watch the auth flow progress!
```

## Versioning

Each state transition maps to a single invocation inside Restate. Restate always executes new invocation on the latest version of the code that has been registered.
That means that if you update your code, in-progress XState state machines will use the new code on their next state transition. This means that state machine definition updates need
to be compatible with the state of machines that exist in Restate.

Generally, XState makes it fairly easy to make backwards compatible state updates; ensure that states are not removed, and any new context values that you rely on are typed as optional.
However, occasionally a significant workflow refactor is needed and its impossible to keep the definition compatible with the state of the existing machines.
In this situation you can use the `versions` field of the options argument to the `xstate` function. This allows you to provide previous state machine definitions, which must have distinct state machine IDs.
New state machines - ie, those created deliberately with `create` or implicitly when `send` operates on a machine with no state saved, will always use the latest code version.
However, in-flight machines will run against the version they started on.

In [`examples/versioning/app.ts`](../examples/src/versioning/app.ts) there is an example of a machine that is versioned in this way. To try out this example:

```bash
# start a local Restate instance
restate-server
# start the service
npm run examples
# register the state machine service against restate
restate dep register http://localhost:9082

# create a state machine
curl http://localhost:8080/counter/myMachine/create
# increment it a few times
curl http://localhost:8080/counter/myMachine/send --json '{"event": {"type": "increment"}}'

# now update the code to swap round the way counterv1 and counterv2 are given to the `xstate` function - the service will reload automatically
# the existing machine will keep using the v2 code:
curl http://localhost:8080/counter/myMachine/send --json '{"event": {"type": "increment"}}'
# but a new machine will now use the v1 code:
curl http://localhost:8080/counter/newMachine/create
curl http://localhost:8080/counter/newMachine/send --json '{"event": {"type": "increment"}}'
```

You can easily see what versions exist in your cluster using Restate's introspection API:

```bash
restate sql "select service_key, value_utf8 from state where key = 'version'"
```

Old workflow definition versions can be removed when the existing state machines on that version are at their terminal state.
If you're using XState `type: "final"` states, you can filter only machines that don't have status `done`:

```bash
restate sql "with keys as
    (select service_key from state where key = 'snapshot' and json_get_str(value_utf8, 'status') != 'done')
    select state.service_key, state.value_utf8 from keys right join state where keys.service_key = state.service_key and key = 'version'"
```

## Subscribing to changes

Calls to `create` or `send` always return immediately with the results of any synchronous transitions that were triggered.
The state machine may later transition due to delayed transitions or promise actors.
It is helpful to be able to subscribe to the state machine to wait for relevant changes.
In native xstate this would be done with the `subscribe` method and the `waitFor` function.
In the Restate integration we expose a similar mechanism via the `waitFor` handler.

`waitFor` accepts three parameters:

- `condition`; what you're waiting for. This accepts either `done`, which is met if the state machine enters a state with `type: "final"`, or `hasTag:${tag}`, which is met if the state machine enters a state with that tag.
- `timeout`; optionally, how many milliseconds to wait before returning an error (HTTP 408) to the caller
- `event`; optionally, an event to process immediately after creating the subscription, equivalent to the same parameter on the `send` handler.

When the condition is met, the waitFor request returns with the snapshot of the state machine that met the condition.
If the state machine completes or enters an error state without the condition being met, `waitFor` returns an error (HTTP 412).

To safely watch for a change from HTTP clients, its best to use idempotent invocations.
These allow for interrupted HTTP requests to `waitFor` to be resumed by simply making the request again with the same idempotency key, without having to initiate a new `waitFor` invocation (in which case, you might miss a state change in the gap between the two requests).
This means that even if your wait time exceeds HTTP response timeouts, you can safely keep long-polling for completion.
A HTTP 5xx can be treated as retryable.
If you don't provide an idempotency key, each call to waitFor will create a new awakeable and save it in state.

For example:

```bash
# start a local Restate instance
restate-server
# start the service
npm run examples
# register the state machine service against restate
restate dep register http://localhost:9080

# create a state machine
curl http://localhost:8080/auth/myMachine/create
# create a waitFor invocation which waits for the machine to complete, and atomically kick off the auth flow
curl http://localhost:8080/auth/myMachine/waitFor --json '{"condition": "done", "event": {"type": "AUTH"}}' -H "idempotency-key: my-key"
# and watch the waitFor call eventually complete!
# you can even call it again afterwards; the original result will be cached for the idempotency retention period
curl http://localhost:8080/auth/myMachine/waitFor --json '{"condition": "done", "event": {"type": "AUTH"}}' -H "idempotency-key: my-key"
```
