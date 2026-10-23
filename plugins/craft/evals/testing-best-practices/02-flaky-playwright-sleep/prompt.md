---
name: "testing-best-practices/flaky-playwright-sleep"
tags: ["testing-best-practices", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

This Playwright test is flaky in CI:

```ts
await page.click('#submit');
await page.waitForTimeout(500);
expect(await page.textContent('.toast')).toBe('Saved');
```
