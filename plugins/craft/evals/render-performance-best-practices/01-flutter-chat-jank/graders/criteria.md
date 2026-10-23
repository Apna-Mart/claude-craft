---
type: "llm"
weight: 1
---

- Flags the per-row `firstWhere` as a linear search per row and replaces it with an id-to-user map built once in the state layer.
- Flags creating a `DateFormat` per row and moves formatting out of build.
- Confirms a lazy `ListView.builder` with stable keys.
- Asks for a measurement in profile mode on a real device (p90/p99 frame time) before and after.
