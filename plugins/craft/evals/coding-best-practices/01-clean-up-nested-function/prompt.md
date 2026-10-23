---
name: "coding-best-practices/clean-up-nested-function"
tags: ["coding-best-practices", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

Clean up this function:

```js
function d(a, b) {
  if (a != null) {
    if (a.active) {
      if (b > 10) {
        return a.p * b * 0.9;
      }
    }
  }
  return a.p * b;
}
```
