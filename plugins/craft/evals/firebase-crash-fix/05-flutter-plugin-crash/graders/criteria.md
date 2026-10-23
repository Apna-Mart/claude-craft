---
type: "llm"
weight: 1
---

- Starts at `cart_dao.dart:58`, the first frame in the app's own package, and uses the library only to learn its precondition (the database must be open).
- Finds the origin: `AppDatabase.close()` closes the database on pause but leaves `_db` set, so the next `instance` call (the refresh on resume) returns the closed database.
- Fixes at that origin (reset `_db` when closing, or stop closing on pause) instead of wrapping the query in try/catch.
- Plans a test that fails on the unfixed code (close, then load items).
