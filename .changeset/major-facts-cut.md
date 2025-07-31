---
"@restatedev/xstate": patch
"@restatedev/xstate-test": patch
---

Update TS SDK, and add final state TTL option

```ts
// Clear the state after 100ms of machine reaching its final state
xstate("myMachine", machine, { finalStateTTL: 100 });
```
