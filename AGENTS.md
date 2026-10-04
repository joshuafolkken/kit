# Agent Instructions

> **All rules for this repository live in [`CLAUDE.md`](./CLAUDE.md). Read it in full before doing
> any work here, and follow every rule in it.** This file exists only to point at it. The rules apply
> to whatever agent is doing the work, but `CLAUDE.md` is written for Claude Code and names its
> features — read them as follows.

- **Hooks.** Codex runs the same hooks from `.codex/hooks.json`, which is generated from
  `.claude/settings.json`. Where Codex does not show a hook's output, apply the rule yourself — resolve
  `JOSH_SESSION_LANG` from `.env` rather than waiting for it to be injected.
- **Skills, `/verify-ui` and `/code-review`.** Where `CLAUDE.md` says to load a skill or run one in a
  subagent, read that skill's `SKILL.md` and follow it in your own session.
- **The `.claude/settings.json` deny list** is not enforced here. The rules it backs — no commits,
  merges, staging or other shared-state changes without instruction — still bind you.
- **`AskUserQuestion`** means asking the user in plain text.

**Do not copy rules back into this file.** Every change to how agents work in this repository belongs
in `CLAUDE.md`.
