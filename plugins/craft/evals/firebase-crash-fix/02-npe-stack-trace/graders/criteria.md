---
type: "llm"
weight: 1
---

- Traces the null back to where it starts: Gson builds an `Order` with a null `cart` when the JSON leaves it out (orders with no items yet), even though Kotlin declares it non-null; does not stop at line 88.
- States a hypothesis and the evidence that would confirm or falsify it before proposing an edit.
- Plans a test that fails on the unfixed code, for example parsing an order JSON with no `cart` or opening such an order.
- Fixes at the model or parsing boundary (an optional or empty cart that the caller handles) rather than a bare `order.cart?.total` at line 88, and says why a bare null check only hides the symptom.
