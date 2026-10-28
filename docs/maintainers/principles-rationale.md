# Principles — rationale

Rationale behind `prompts/collaboration-workflow/principles.md`.

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

## Why concise-prose exists

Prose the agent wrote kept coming out long, and the owner trimmed it afterwards: 20 commits titled
`Shorten` / `Trim` / `Condense`, and 373 lines over 400 characters across the docs, prompts and skills
(joshuafolkken/kit#3865).

The "冗長さ" goal in quality-priority covers duplication only, so no rule said how to write. The
recurring patterns — a packed paragraph, history in the body, heavy bold, restatement and meta
sentences — each became one bullet of the rule.

## Why concise-reply exists

concise-prose covers what is written to files, not the chat reply. Replies reporting two filings ran
to about 1,100 characters — a table and four paragraphs — where the owner wanted the conclusion, the
points and the next step (joshuafolkken/kit#5328). A local memory note only reached the session that
loaded it and never a consumer, so `stop:guard` measures the reply instead.

## Why a remedy for defects never halts evolution

Asked about the number of defects, the agent proposed pausing new optimizations as the root fix
(joshuafolkken/kit#4492). The owner's policy is to keep evolving and to prevent defects without
stopping; when something is done is decided by priority. No prompt said so, so each new session made
the same proposal again.

The rule names the alternative — mechanisms that prevent defects while work
continues — so the agent has something to propose instead.
