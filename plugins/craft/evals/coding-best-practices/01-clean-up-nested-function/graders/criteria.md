---
type: "llm"
weight: 1
---

- Renames `d`, `a`, `b` and `p` to intent-revealing names and replaces `0.9` and `10` with named constants.
- Flattens the nesting with guard clauses or a named predicate.
- Notices that the final `return a.p * b` throws when `a` is null, and handles that case on purpose.
- Adds no comments or docstrings to the code it writes.
