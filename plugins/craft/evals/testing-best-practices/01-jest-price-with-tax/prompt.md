---
name: "testing-best-practices/jest-price-with-tax"
tags: ["testing-best-practices", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

Write Jest tests for this:

```js
export function priceWithTax(price) {
  if (price < 0) throw new RangeError('price must be >= 0');
  return Math.round(price * 1.07 * 100) / 100;
}
```
