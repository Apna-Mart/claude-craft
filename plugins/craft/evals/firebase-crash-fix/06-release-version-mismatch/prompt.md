---
name: "firebase-crash-fix/release-version-mismatch"
tags: ["firebase-crash-fix", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

Crashlytics says this only happens on 4.2.0 (311) and later, iOS 17 and 18. Can you fix it?

Fatal error: Index out of range
0  Shop  0x1042 ProductGalleryView.image(at:) + 212 (ProductGalleryView.swift:73)
1  Shop  0x1043 ProductGalleryView.collectionView(_:cellForItemAt:) + 96 (ProductGalleryView.swift:118)
