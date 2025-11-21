# @restatedev/xstate-test

## 1.0.0

### Minor Changes

- Add a `waitFor` handler

### Patch Changes

- Updated dependencies
  - @restatedev/xstate@0.4.0

## 0.3.1

### Patch Changes

- f96eba7: Update TS SDK, and add final state TTL option

  ```ts
  // Clear the state after 100ms of machine reaching its final state
  xstate("myMachine", machine, { finalStateTTL: 100 });
  ```

- Updated dependencies [f96eba7]
  - @restatedev/xstate@0.3.1

## 0.3.0

### Minor Changes

- c0900c6: Introduce `@restatedev/xstate-test`

### Patch Changes

- 7000845: Introduce `createRestateTestActor`
- Updated dependencies [c0900c6]
- Updated dependencies [7000845]
  - @restatedev/xstate@0.3.0
