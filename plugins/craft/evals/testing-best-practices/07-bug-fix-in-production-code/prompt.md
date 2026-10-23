---
name: "testing-best-practices/bug-fix-in-production-code"
tags: ["testing-best-practices", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

Customers with a 100% coupon are being charged ₹0.01. Fix it:

```python
def final_price(price: Decimal, discount_pct: Decimal) -> Decimal:
    discounted = price * (1 - discount_pct / 100)
    return max(discounted, Decimal("0.01"))
```
