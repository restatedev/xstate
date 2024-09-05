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

In [`example/app.ts`](./example/app.ts) you will see an example of an XState machine
that uses cross-machine communication, delays, and Promise actors, all running in Restate.
Most XState machines should work out of the box, but this is still experimental, so
we haven't tested everything yet!

To try out this example:

```bash
# start a local Restate instance
restate-server
# start the service
npm run example
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
