---
type: "llm"
weight: 1
---

- Builds a case table covering a null title, a very long title and a very large amount; every row names the test that covers it (marked not run when nothing can run here), is ruled out with a reason, or is flagged as an open question for the user.
- Screenshot tests at a small smallest width (320–360dp) with a large font scale (1.5–2.0), using Paparazzi or Roborazzi.
- Flags the `!!` null crash and the fixed 64.dp height as clipping risks.
- Gives `adb` commands for a device check (font scale, density or size).
