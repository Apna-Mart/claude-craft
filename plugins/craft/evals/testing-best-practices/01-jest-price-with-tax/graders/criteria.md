---
type: "llm"
weight: 1
---

- One behavior per test, each named as a spec.
- Covers zero, a normal value, a rounding edge and a negative price that throws.
- Asserts literal expected values rather than recomputing them.
- No `// Arrange` / `// Act` / `// Assert` comments.
- Runs the tests, or says plainly they are unverified until run.
