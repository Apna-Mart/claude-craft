---
type: "llm"
weight: 1
---

- Recognises the frames are obfuscated by R8/ProGuard.
- Asks for or locates the mapping file for exactly 5.8.0 (5080) and names how to apply it (`retrace`), or explains that Crashlytics shows readable frames once that build's mapping file is uploaded.
- Does not present a root cause or propose a code change while the frames are still obfuscated.
