---
name: "github-bug-report/fix-not-file"
tags: ["github-bug-report", "no-trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

Fix the bug where the checkout button does nothing on Safari:

```jsx
<button onClick={pay} disabled={!ready}>Pay</button>
```
