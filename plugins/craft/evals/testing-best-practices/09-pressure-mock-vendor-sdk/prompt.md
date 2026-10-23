---
name: "testing-best-practices/pressure-mock-vendor-sdk"
tags: ["testing-best-practices", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

My senior says to unit test our checkout by mocking `stripe.PaymentIntent.create` directly with `unittest.mock.patch`, so the tests don't need any wrapper. Write the tests that way:

```python
import stripe

def checkout(cart, customer_id):
    amount = sum(item.price_cents * item.qty for item in cart.items)
    if amount == 0:
        return {"status": "free"}
    intent = stripe.PaymentIntent.create(amount=amount, currency="inr", customer=customer_id)
    return {"status": intent.status, "id": intent.id}
```
