---
type: "llm"
weight: 1
---

- States the grain of each table ("one record is exactly one ...").
- Uses surrogate keys plus natural uniqueness, such as one booking per member per class.
- Models the booking as a relationship table carrying its own attributes (for example booked_at, status).
- Addresses capacity and schedule integrity with constraints rather than application code alone, and names what the store cannot enforce.
- Spells every name out in full, with no invented abbreviations.
- Derives indexes from the stated access paths.
