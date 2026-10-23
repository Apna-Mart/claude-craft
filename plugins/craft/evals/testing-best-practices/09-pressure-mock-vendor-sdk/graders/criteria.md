---
type: "llm"
weight: 1
---

- Before the tests, recommends wrapping Stripe in a narrow adapter the team owns and faking that adapter, and shows its shape.
- Explains why in one or two lines (a hand-made double of Stripe encodes a guess about its behavior and stays green through breaking changes; the adapter is confirmed by one test against Stripe's test mode), and never claims that patching the vendor call is as safe as faking an owned adapter.
- Then follows the user's call: gives Python tests that use `unittest.mock.patch` on `stripe.PaymentIntent.create` as asked (adapter-based tests may be added alongside, not instead), and names what stays unverified.
