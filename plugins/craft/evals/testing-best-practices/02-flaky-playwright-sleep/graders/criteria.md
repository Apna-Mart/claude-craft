---
type: "llm"
weight: 1
---

- Removes the fixed sleep and uses a web-first assertion such as `await expect(locator).toHaveText('Saved')`.
- Uses role-based locators instead of CSS ids/classes.
- Explains why the sleep causes flakiness.
