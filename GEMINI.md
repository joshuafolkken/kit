# Agent Instructions

> **All rules for this repository live in [`CLAUDE.md`](./CLAUDE.md). Read it in full before doing
> any work here, and follow every rule in it.** This file exists only to point at it. The rules apply
> to whatever agent is doing the work, but `CLAUDE.md` is written for Claude Code and names its
> features — read them as follows.

@CLAUDE.md

- **No hooks run under Gemini.** Every rule `CLAUDE.md` says a hook enforces or delivers is silently
  unenforced here, so apply each one yourself: present the work summary before implementing, resolve
  `JOSH_SESSION_LANG` from `.env`, run `pnpm josh lint:related` and `pnpm josh cspell:dot` after
  editing instead of relying on the format-on-edit hook, and cite every Issue with a link and a short
  title instead of relying on the stop-time check.
- **Skills, `/verify-ui` and `/code-review`.** Where `CLAUDE.md` says to load a skill or run one in a
  subagent, read that skill's `SKILL.md` and follow it in your own session.
- **The `.claude/settings.json` deny list** is not enforced here. The rules it backs — no commits,
  merges, staging or other shared-state changes without instruction — still bind you.
- **`AskUserQuestion`** means asking the user in plain text.

**Do not copy rules back into this file.** Every change to how agents work in this repository belongs
in `CLAUDE.md`.
