---
name: "design-patterns-best-practices/plain-bug-fix"
tags: ["design-patterns-best-practices", "no-trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

Fix this bug: getPrice returns undefined for the 'gold' tier.

```js
function getPrice(tier) {
  switch (tier) {
    case 'basic': return 10;
    case 'pro': return 20;
  }
}
```
