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

In [`examples/auth/app.ts`](./examples/auth/app.ts) you will see an example of an XState machine
that uses cross-machine communication, delays, and Promise actors, all running in Restate.
Most XState machines should work out of the box, but this is still experimental, so
we haven't tested everything yet!

To try out this example:

```bash
# start a local Restate instance
restate-server
# start the service
npm run auth-example
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

In [`examples/versioning/app.ts`](./examples/versioning/app.ts) there is an example of a machine that is versioned in this way. To try out this example:

```bash
# start a local Restate instance
restate-server
# start the service
npm run versioning-example
# register the state machine service against restate
restate dep register http://localhost:9080

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

## 🛠 Contributing

Please see the [Development Guide](./DEVELOPMENT.md) for setup instructions, testing, linting, and release workflow.
