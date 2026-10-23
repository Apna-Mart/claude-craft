---
type: "llm"
weight: 1
---

- Explains the race: slower old responses overwrite newer ones.
- Fixes it with latest-wins cancellation (`flatMapLatest` or `mapLatest`, chosen by what the transform returns) plus debounce.
- Mentions collecting with `collectAsStateWithLifecycle()` or the `@OptIn` the operators need.
