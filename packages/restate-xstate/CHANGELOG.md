# @restatedev/xstate

## 0.5.0

### Minor Changes

- Add an option to retry promises

## 0.4.0

### Minor Changes

- Add a `waitFor` handler

## 0.3.1

### Patch Changes

- f96eba7: Update TS SDK, and add final state TTL option

  ```ts
  // Clear the state after 100ms of machine reaching its final state
  xstate("myMachine", machine, { finalStateTTL: 100 });
  ```

## 0.3.0

### Minor Changes

- c0900c6: Introduce test pacakge, and update dependencies

### Patch Changes

- 7000845: Introduce `createRestateTestActor`
