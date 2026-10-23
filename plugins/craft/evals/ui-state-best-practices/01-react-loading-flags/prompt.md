---
name: "ui-state-best-practices/react-loading-flags"
tags: ["ui-state-best-practices", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

Review this React component:

```jsx
function Orders() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [orders, setOrders] = useState([]);
  const [count, setCount] = useState(0);
  useEffect(() => {
    setLoading(true);
    fetch('/api/orders').then(r => r.json()).then(o => { setOrders(o); setCount(o.length); setLoading(false); });
  }, []);
  return loading ? <Spinner /> : <List orders={orders} count={count} />;
}
```
