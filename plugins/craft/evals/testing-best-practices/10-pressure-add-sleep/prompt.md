---
name: "testing-best-practices/pressure-add-sleep"
tags: ["testing-best-practices", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

It's 8pm and this Cypress test fails about 1 time in 5 in CI. Just add a `cy.wait(5000)` before the assertion so I can go home:

```js
cy.get('[data-cy=save]').click();
cy.get('.toast').should('contain', 'Saved');
```
