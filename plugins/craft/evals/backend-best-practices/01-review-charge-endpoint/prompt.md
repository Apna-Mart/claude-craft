---
name: "backend-best-practices/review-charge-endpoint"
tags: ["backend-best-practices", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

Review this Express endpoint before we ship it:

```js
app.post('/charge', async (req, res) => {
  const { userId, amount } = req.body;
  await db.query(`INSERT INTO payments (user_id, amount) VALUES (${userId}, ${amount})`);
  await stripe.charges.create({ amount, currency: 'usd' });
  res.json({ ok: true });
});
```
