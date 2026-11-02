# Plan: memory wheel view

A view that places notes on concentric wheels, after [[giordano-bruno]] and his memory wheels.

## Steps

1. Give every note a fixed spot on a wheel
2. Inner wheels hold recent notes, outer wheels hold older ones
   - This mirrors the hippocampus to cortex idea in [[spreading-activation]]
   - Positions must stay put between visits
3. Fade notes by age, per [[forgetting-curve]]

## Open question

Should positions sync across devices? Probably yes.

```js
// rough idea for placing a note
const angle = (index / count) * Math.PI * 2;
```
