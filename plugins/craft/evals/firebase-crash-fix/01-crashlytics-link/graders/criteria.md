---
type: "llm"
weight: 1
---

- Does not jump to a code fix; gathers the issue and its events first.
- Notes that `android:com.example.shop` is a package name, not the Firebase app ID, and resolves the real app ID (for example via firebase_get_environment or firebase_list_apps) or asks for access.
- If the Firebase tools are unavailable, says exactly what it needs instead of guessing a cause.
