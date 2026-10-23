---
type: "llm"
weight: 1
---

- Says `count` is derived from `orders` and should not be stored.
- Replaces the loading/error/data flags with a tagged union.
- Moves server data to a query layer (for example TanStack Query) and mentions setting `staleTime` deliberately.
- Notes the missing error path.
- Shows Bad/Good pairs in React and cites no rule numbers.
