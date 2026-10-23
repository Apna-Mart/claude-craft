---
type: "llm"
weight: 1
---

- Explains that the cron fires once per replica.
- Recommends exactly one runner: a leader lease, a distributed lock with a lease, or a single-runner scheduler.
- Also makes the job itself idempotent as a backstop (for example a unique key per customer per billing period).
- Gives concrete Spring/Java-flavoured guidance rather than generic prose.
