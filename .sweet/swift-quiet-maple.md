---
type: fix
---

`pnpm dev` runs on Windows: pnpm uses its own shell for package scripts, and a dev daemon keeps its worktrees in the checkout's `.data`.
