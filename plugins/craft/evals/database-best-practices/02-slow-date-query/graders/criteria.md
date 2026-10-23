---
type: "llm"
weight: 1
---

- Rewrites the predicate as a half-open range on `created_at` instead of wrapping the column in a function.
- Flags `SELECT *` and recommends listing only the needed columns (it cannot know which ones, so naming the change is enough).
- Recommends an index that serves the range and the sort, and confirming with EXPLAIN on production-like data.
