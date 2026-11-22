---
data:
  priority: high
  status: done
  type: bug
id: k7m2q
title: Find agent programs on Windows whatever case PATH has
---
Geordi 0.8.0-beta.2 on Windows fails a turn with “Geordi could not find `opencode`. Install it, or put it on your PATH.” while Settings lists OpenCode as discovered.

The daemon decides what is available with `process.env`, which Windows answers to whatever case `PATH` is spelled in. The host builds its environment as `{ ...process.env, ...options.env }`, a plain object that keeps the spelling `Path`, so `agentProgram` read no `PATH` at all and found nothing. Two further faults lay behind it on Windows: a name on `PATH` resolved to the extensionless shell script npm writes for other systems, which Windows cannot run, and Node refuses to start the `.cmd` npm writes for Windows itself.

`agentProgram` now reads `PATH` and `PATHEXT` however they are spelled, and only takes a file Windows can run. `programCommand` starts a `.cmd` or `.bat` through `cmd.exe`, with the command line given as it is, and the model list in Settings runs the program the same way.

Verified on Windows with npm's OpenCode 2.3.2: it is found from a copy of the daemon's environment, starts in ACP mode through `cmd.exe`, answers `initialize`, and `opencode models` lists its models. `program.spec.ts` covers the resolution and the launch, and `session.spec.ts` a host whose environment says `Path`.

Out of the same work: the desktop build's pnpm helper (`packages/launch/src/stage.js`) ran `npm_execpath`, a `.cjs` Windows cannot start (`EFTYPE`) — it now goes through `cmd.exe`, which finds whatever pnpm is installed. The `.npmrc` shell-emulator lets `pnpm dev`'s POSIX env-prefix scripts run on Windows, the daemon's dev script keeps worktrees in `.data`, and Prettier's `endOfLine: auto` lets `pnpm lint` pass on a Windows checkout.
