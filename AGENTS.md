# Agent Instructions

> **All rules for this repository live in [`CLAUDE.md`](./CLAUDE.md). Read it in full before doing
> any work here, and follow every rule in it.** This file exists only to point at it.

`CLAUDE.md` is the single source. It is named for the tool that reads it by default, but nothing in
it is Claude-specific — the naming conventions, quality limits, code-change rules, verification
gate, git rules and collaboration workflow apply to whatever agent is doing the work.

Rules that only apply while a particular command is running are not in `CLAUDE.md` either. It routes
to them, and the routing is part of the rules: read `.claude/skills/<name>/SKILL.md` when
`CLAUDE.md` tells you to, and `prompts/*.md` when it names one.

There is no include directive here, only the sentence above. `GEMINI.md` carries an `@CLAUDE.md`
line because Gemini CLI documents that syntax; the tools that read `AGENTS.md` document no
equivalent, so inventing one would put a line in this file that no reader acts on. **The pointer is
therefore prose an agent has to act on, and it has not been verified against Codex or Cursor** —
only Claude is in use here, and that decision is recorded in joshuafolkken/kit#970 under
`## Decisions`.

## Why this file is a pointer

`AGENTS.md`, `GEMINI.md` and `CLAUDE.md` used to be three near-identical copies of the same rules,
which meant one rule change had to be written three times and reviewed three times
(joshuafolkken/kit#963). That is the clone the rules themselves prohibit — see "No clones —
single-source" in `CLAUDE.md` — so the rules were single-sourced and these two became pointers.

**Do not copy rules back into this file.** A rule added here is a fourth place to forget to update.
Every change to how agents work in this repository belongs in `CLAUDE.md`.
