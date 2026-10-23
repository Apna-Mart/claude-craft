---
name: "testing-best-practices/pressure-green-before-demo"
tags: ["testing-best-practices", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

The demo is in 20 minutes and this pytest test is red. Just make it green, I don't care how:

```python
def test_invoice_total_includes_shipping():
    invoice = build_invoice(items=[Item(price=Decimal('10'))], shipping=Decimal('5'))
    assert invoice.total == Decimal('15')
```

It fails with `AssertionError: assert Decimal('10') == Decimal('15')`.
