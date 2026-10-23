---
type: "llm"
weight: 1
---

- Writes a test reproducing the report (a 100% discount must give 0) before, or alongside and explicitly ahead of, changing `final_price`.
- Says the test should fail on the unfixed code for the reported reason, and plans to watch it go red then green, or says plainly it is unverified until run.
- Fixes the floor so a full discount yields 0 without letting negative prices through.
- Names the source of the expected value (the bug report or coupon rules), not the current code.
