---
type: "llm"
weight: 1
---

- Separates assignment from exposure, logs exposure when the variant is actually shown, and keeps the assignment log.
- Logs control exposures too and uses the same unit id on flag evaluation, exposure and metric events.
- Plans a sample ratio mismatch check before reading metrics.
- Names one primary metric, guardrails with margins, and a decision rule written before launch.
