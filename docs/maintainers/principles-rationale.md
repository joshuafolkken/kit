# Principles — rationale

This is maintainer-only history behind `prompts/collaboration-workflow/principles.md`, the single
source of the principles `CLAUDE.md`'s Communication section points at. It is never read during
a run, and a change to this file changes no rule. The original seven used to be separate topic files, each
closed by the same boilerplate line naming its `CLAUDE.md` bullet; they were merged into one file and
the history below moved here (joshuafolkken/kit#2894).

## Why AGENTS and GEMINI are pointers

`AGENTS.md`, `GEMINI.md` and `CLAUDE.md` used to be three near-identical copies of the same rules,
which meant one rule change had to be written three times and reviewed three times, and all three
sat within 1 KB of the resident ceiling (joshuafolkken/kit#963). That is the clone the rules
themselves prohibit — "No clones — single-source" in `CLAUDE.md` — so the document that wrote the
prohibition was violating it. The rules were single-sourced in `CLAUDE.md` and the other two became
pointers.

The two pointers once each carried a "Why this file is a pointer" section restating this paragraph,
beside the same statement at the top of `CLAUDE.md` and in `single-source-rules.md`. Four copies of
one explanation is the same clone at a smaller scale, so the pointers were cut to the pointer
sentence and the prohibition on copying rules back (joshuafolkken/kit#2894).

`scripts/document/ai-document-pointers.test.ts` keeps it that way mechanically: it fails when a rule
body reappears in a pointer, when the pointer sentence disappears, or when `CLAUDE.md` stops saying it
is the single source. The pointers carry only their tool-specific line; the shared reading for other
agents lives once, in `principles.md`'s section on agents other than Claude Code.

## The include line, and what has not been verified

`AGENTS.md` carries no include directive, only the sentence. `GEMINI.md` carries an `@CLAUDE.md`
line because Gemini CLI documents that import syntax, which pulls the file in rather than relying on
the agent to open it; it is written alongside the prose pointer rather than instead of it, so an
agent that does not understand the syntax still reads the sentence. The tools that read `AGENTS.md`
document no equivalent, so inventing one would put a line in that file no reader acts on.

**Neither form has been verified against Codex, Cursor or a live Gemini CLI.** Only Claude is in use
here, and that decision is recorded in joshuafolkken/kit#970 under `## Decisions`. When a tool that
does not follow the pointer comes into use, it is handled separately at that point.

## Why clone:scan exists

The no-clones trigger — "the moment you are about to replicate" — relied on self-awareness, with no
way to check that it held: `sonarjs/no-identical-functions` sees only within one file. `josh
clone:scan` was added as the measurement that rule lacked (joshuafolkken/kit#2217).

## An application of simplicity-first

joshuafolkken/kit#2329: a bare `#N` leaked into session-facing output, and the `Stop` hook made the
whole reply be reissued, which duplicated it. The naive answer was to strengthen the hook that
scolds; the elegant answer was to fix the printer that supplied the bare `#N`. With the material
gone, the scolding fires less often by itself.
