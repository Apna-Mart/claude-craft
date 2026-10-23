---
name: "coding-best-practices/add-retry-surgically"
tags: ["coding-best-practices", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

Add a retry to this call and leave everything else alone:

```python
def load_profile(user_id):
    resp = requests.get(f"{BASE}/users/{user_id}", timeout=5)
    resp.raise_for_status()
    return resp.json()
```
