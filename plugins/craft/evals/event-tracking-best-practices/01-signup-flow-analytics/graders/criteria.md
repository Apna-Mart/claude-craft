---
type: "llm"
weight: 1
---

- Starts from the decision and metric (step-by-step signup conversion) before listing events.
- Gives each event its where (client for views and attempts, backend after commit for account created), what (name and properties) and how (event id, event time, identity).
- Bridges the anonymous id to the new user id at signup and passes the anonymous id to the backend.
- Uses one naming convention with no names built from values, and puts no personal data in properties.
