# Synthetic runtime observation

The public Candidate observation contains:

- `state.status`;
- an `effects` array whose entries have a `type`;
- `repeat.status`;
- a `repeat.effects` array;
- an optional `transport` diagnostic that is not a product outcome.

The current observer does not expose how long return audit evidence is retained. A policy aspiration of
90-day retention therefore cannot be fairly hard-judged by this observer.
