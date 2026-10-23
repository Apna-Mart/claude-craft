---
name: "github-bug-report/coupon-stack-trace"
tags: ["github-bug-report", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

File this as a GitHub issue:

```
TypeError: Cannot read properties of undefined (reading 'id')
    at CartService.applyCoupon (cart.service.ts:142)
```

It happens when applying an expired coupon on web, v3.4.1, Chrome 128. Always reproducible: add an item, enter code EXPIRED10, click Apply.
