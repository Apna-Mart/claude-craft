---
name: "minimize-diff/review-for-bugs"
tags: ["minimize-diff", "no-trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

Review this diff for bugs:

```diff
- if (items.length > 0) return items[0];
+ if (items.length >= 0) return items[0];
```
