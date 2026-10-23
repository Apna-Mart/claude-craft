---
name: "database-best-practices/slow-date-query"
tags: ["database-best-practices", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

This Postgres query is slow on a 50M-row table. Fix it:

SELECT * FROM events WHERE date(created_at) = '2026-01-01' ORDER BY created_at DESC LIMIT 50;
