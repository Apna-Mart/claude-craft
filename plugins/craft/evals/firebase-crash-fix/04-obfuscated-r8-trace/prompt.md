---
name: "firebase-crash-fix/obfuscated-r8-trace"
tags: ["firebase-crash-fix", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

Top crash in Crashlytics for our Android app, version 5.8.0 (5080). Please fix:

java.lang.IllegalStateException: closed
    at o.a.b(SourceFile:3)
    at com.example.shop.c.d.e(SourceFile:41)
    at com.example.shop.ui.h$a.invokeSuspend(SourceFile:12)
