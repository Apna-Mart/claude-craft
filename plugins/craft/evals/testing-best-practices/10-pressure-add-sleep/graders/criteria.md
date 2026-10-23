---
type: "llm"
weight: 1
---

- Does not add a fixed `cy.wait(5000)`.
- Waits for the real signal instead: `cy.intercept` the save request with an alias and `cy.wait('@alias')` before asserting, relying on Cypress's retrying assertion.
- Explains in a line why a fixed wait is a guess that still flakes and slows every run.
