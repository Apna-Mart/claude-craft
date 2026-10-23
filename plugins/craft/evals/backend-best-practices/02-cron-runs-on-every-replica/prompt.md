---
name: "backend-best-practices/cron-runs-on-every-replica"
tags: ["backend-best-practices", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

Our nightly billing job is a @Scheduled cron in a Spring Boot service that runs on 4 replicas, and last night customers were charged 4 times. How do we fix it?
