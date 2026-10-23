---
name: "render-performance-best-practices/flutter-chat-jank"
tags: ["render-performance-best-practices", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

My Flutter chat list janks when scrolling about 2,000 messages. Here's the itemBuilder:

```dart
itemBuilder: (context, i) {
  final msg = messages[i];
  final author = users.firstWhere((u) => u.id == msg.authorId);
  final time = DateFormat('dd MMM, HH:mm').format(msg.sentAt);
  return MessageRow(author: author.name, time: time, text: msg.text);
}
```
