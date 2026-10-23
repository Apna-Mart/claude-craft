---
type: "llm"
weight: 1
---

- Puts the fake source and its wiring in the debug source set or a mock flavour, swapped at one seam, not `if (BuildConfig.DEBUG)` checks inside business logic.
- Reuses one set of named sample cases for the debug menu and the tests.
- Gives a check that the release build doesn't contain the fake (R8 mapping file or apkanalyzer).
