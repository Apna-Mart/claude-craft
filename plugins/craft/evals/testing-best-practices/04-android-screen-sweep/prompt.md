---
name: "testing-best-practices/android-screen-sweep"
tags: ["testing-best-practices", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

Test this Compose card thoroughly on small phones and big fonts. I want screenshot tests at different smallest widths and font scales, and no null or long-text case missed:

```kotlin
@Composable
fun OrderCard(order: Order) {
    Row(Modifier.fillMaxWidth().height(64.dp)) {
        Text(order.title!!, maxLines = 1)
        Text("₹${order.amount}")
    }
}
```
