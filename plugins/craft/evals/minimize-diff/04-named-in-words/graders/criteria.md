---
type: "llm"
weight: 1
---

- Before cutting anything, resolves the source and target (current branch against main) and echoes what it resolved, or reports plainly that there is nothing to diff (no git repository, no commits, or the current branch is main itself).
- Does not claim cuts, numbers or verification it did not produce.
