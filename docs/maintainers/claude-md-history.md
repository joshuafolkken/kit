# CLAUDE.md — history

This is maintainer-only history behind `CLAUDE.md`. It is never read during a run — every trigger,
command and pointer an agent acts on stays in `CLAUDE.md`, and a change to this file changes no rule.

## Why `CLAUDE.md` is the only rule file

`AGENTS.md` and `GEMINI.md` once carried their own copies of the rules, and a wording fix had to be
made three times. joshuafolkken/kit#963 made `CLAUDE.md` the single source and reduced the other two to
pointers, so a rule addition, spec change or wording fix is written once.

## Removed shorthand commands

- **`queue`** was removed in joshuafolkken/kit#1984. Its job — run named Issues in order, then drain the
  opted-in backlog — folded into `backlogrun #N1 #N2 …`.
- **`epicrun`** was removed in joshuafolkken/kit#1985. A `backlogrun` named item may now be an epic,
  whose children all run before the next item, so `backlogrun #E --only` runs one epic's children and
  stops; dropping `--only` also drains the backlog.

`CLAUDE.md` keeps only the redirect a user who types either keyword needs.

## Why each rule is stated once

`CLAUDE.md` and the `UserPromptSubmit` hook are loaded on every turn, so one duplicated line is paid
for on every turn. joshuafolkken/kit#2889 removed the repeated statements: the Code Change Rules steps
carry the refactor, gate and IDE procedure, the Completion gate keeps only the order and points at
them, and Pre-commit Self-Review carries the review round cap. The hook that restated Code Change
Rules Step 0 was cut to its trigger and pointer — `pnpm josh report:lint` checks the format — and the
hook stating that deleting a git-tracked file is reversible was moved into the Tier C definition,
which `CLAUDE.md` loads on every session anyway.

## Explanations moved out of `CLAUDE.md`

joshuafolkken/kit#2994 moved the sentences that explained a rule rather than stated one, so the file
every session loads carries the trigger and the pointer alone:

- **How a rule is written.** Each rule is a trigger plus a pointer — enough to act safely with nothing
  else loaded, with the steps and rationale at the pointer (`prompts/collaboration-workflow/residency.md`).
- **What `pnpm josh pkg:scout` measures.** It ranks the candidate packages by downloads, last publish,
  bundled types, license and install size, and prints `clear` when the leader is ahead by at least the
  near-tie threshold or `close` when the top two are within it — so "clearly best" and "genuine
  toss-up" are read off the output rather than decided by impression.
- **Who reads `.env`.** The AI scripts, `josh port` and `playwright.config.ts`.
- **Why the code-line limits are not `wc -l`.** `max-lines` / `max-lines-per-function` run with
  `skipBlankLines` + `skipComments`.
- **Why the self-review is authoritative.** CI runs no Claude review, so the pre-commit pass is the only
  one. `pnpm josh disposition <path>` answers whether a finding reaches a runtime path, so the only
  judgement left when routing a finding is whether the defect is confirmed.

The same Issue moved the Step 0 reminder off `UserPromptSubmit`. As an `echo` it was injected into every
prompt — a question that writes nothing included — and re-read as context on each later turn; it now
fires once, on a session's first `Edit` / `Write` of a runtime file (`scripts/hooks/step-zero-notice.ts`),
and the prompt hook is the single session-language process.
