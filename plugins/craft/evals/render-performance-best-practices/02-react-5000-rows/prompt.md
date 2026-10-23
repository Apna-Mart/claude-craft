---
name: "render-performance-best-practices/react-5000-rows"
tags: ["render-performance-best-practices", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

Make this React list of 5,000 products scroll smoothly at 120 Hz:

```jsx
function Products({ items, q }) {
  const shown = items.filter(p => p.name.includes(q)).sort((a, b) => a.price - b.price);
  return <div>{shown.map(p => <Row product={p} />)}</div>;
}
```
