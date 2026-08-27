# Agent Instructions

> **All rules for this repository live in [`CLAUDE.md`](./CLAUDE.md). Read it in full before doing
> any work here, and follow every rule in it.** This file exists only to point at it.

@CLAUDE.md

`CLAUDE.md` is the single source. It is named for the tool that reads it by default, but nothing in
it is Claude-specific — the naming conventions, quality limits, code-change rules, verification
gate, git rules and collaboration workflow apply to whatever agent is doing the work.

Rules that only apply while a particular command is running are not in `CLAUDE.md` either. It routes
to them, and the routing is part of the rules: read `.claude/skills/<name>/SKILL.md` when
`CLAUDE.md` tells you to, and `prompts/*.md` when it names one.

## Why this file is a pointer

`AGENTS.md`, `GEMINI.md` and `CLAUDE.md` used to be three near-identical copies of the same rules,
which meant one rule change had to be written three times and reviewed three times
(joshuafolkken/kit#963). That is the clone the rules themselves prohibit — see "No clones —
single-source" in `CLAUDE.md` — so the rules were single-sourced and these two became pointers.

The `@CLAUDE.md` line above is Gemini CLI's own import syntax, which pulls the file in rather than
relying on the agent to open it. It is written alongside the prose pointer rather than instead of
it: an agent that does not understand the syntax reads the sentence, and one that does gets the
rules without a tool call. **Neither form has been verified against a live Gemini CLI** — only
Claude is in use here, and that decision is recorded in joshuafolkken/kit#970 under `## Decisions`.

**Do not copy rules back into this file.** A rule added here is a fourth place to forget to update.
Every change to how agents work in this repository belongs in `CLAUDE.md`.
