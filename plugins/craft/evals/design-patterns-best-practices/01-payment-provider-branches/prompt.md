---
name: "design-patterns-best-practices/payment-provider-branches"
tags: ["design-patterns-best-practices", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

Which design pattern should I use here? We call Stripe and Razorpay, and `if (provider === 'stripe') { ... } else if (provider === 'razorpay') { ... }` appears in 4 files. We're adding PayPal next month.
