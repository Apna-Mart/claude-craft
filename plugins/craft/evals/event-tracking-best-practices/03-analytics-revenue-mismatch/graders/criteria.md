---
type: "llm"
weight: 1
---

- Suspects duplicates (retries without a stable event id, client and server copies of the same event) and revenue sent from the client.
- Checks units and currency conversion, refunds, and time zone or event-time vs received-time boundaries.
- Recommends billing or payment-provider notifications as the source of truth and reconciling on a schedule.
