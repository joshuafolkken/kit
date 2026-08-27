---
name: workflow-commands
description: The procedures for the Issue-driven shorthand commands `kickoff`, `fullrun`, `halfrun`, `queue` and `epicrun` — planning, implementation, the verification gate, unattended epic execution, the `/code-review` → `followup --merge` chain rule, auto-merge and the Telegram notifications. Read this the moment the user types one of those keywords (with or without `#N` / `new`), before running any command, and read it too when asked what one of them does or when a run of one has to be resumed or repaired.
---

# Issue-driven workflow commands

`kickoff`, `fullrun`, `halfrun`, `queue` and `epicrun` are the shorthand commands this package's
collaboration workflow is built on. Their procedures live here rather than in `CLAUDE.md` because
each one applies only while its own command is running — keeping them resident spent context on
every turn to describe a workflow most turns never enter.

The canonical extended reference is `prompts/collaboration-workflow/` (indexed by `prompts/collaboration-workflow.md`); this skill is the
operational procedure, and the two must agree.

## 0. The rule that fires before any of them — explicit invocation

**Never start a `kickoff` / `halfrun` / `fullrun` / `queue` / `epicrun` workflow (including their
`#N` and `new` variants) unless the user has typed the keyword in the current turn's prompt.** This rule is also
resident in the AI documents, because it has to hold when this skill has *not* been loaded.

- Conversational requests like "implement X", "fix Y", "open a PR for Z" are **NOT** implicit
  invocations. Even if the task clearly fits one of these workflows, do not infer authorization from
  the request shape.
- Do **NOT** ask confirmation questions like "May I proceed with `halfrun new`?" or "Shall I run
  `fullrun`?". A confirmation prompt is not an acceptable substitute for explicit invocation.
- Instead, **prompt the user to type the command themselves**, with the exact phrasing: "Please run
  \`<command>\` to start this task."
- The rule applies even when the user authorized a related workflow in an earlier turn. Each
  invocation must be re-typed by the user in the current turn.

## 1. Which file to read

Read this file, then the one for the command that was typed. `fullrun` and `queue` also need
`chain-rule.md` and `followup.md`; `halfrun` needs neither, because it stops before the commit.

| Typed keyword                            | Read                                        |
| ---------------------------------------- | ------------------------------------------- |
| `kickoff` / `kickoff #N` / `kickoff new` | `kickoff.md` + `split-assessment.md`        |
| `fullrun` / `fullrun #N` / `fullrun new` | `fullrun.md` + `split-assessment.md` + `chain-rule.md` + `followup.md` |
| `halfrun` / `halfrun #N` / `halfrun new` | `halfrun.md` + `split-assessment.md`        |
| `queue #N1 #N2 …`                        | `queue.md` + `fullrun.md` + `chain-rule.md` + `followup.md` |
| `epicrun #E`                             | `epicrun.md` + `split-assessment.md` + `fullrun.md` + `chain-rule.md` + `followup.md` |

## 2. What every one of them shares

- **The verification gate**, in this order: refactor per `prompts/refactoring.md` → `pnpm josh gate` (lint, type check, spell check and unit tests, run concurrently) → `/code-review medium`
  on `git diff main`, iterating until no high/medium findings remain — **at most two reviews in total**
  (`prompts/review.md` → "Review round cap"). `kickoff` is the exception —
  it never implements, so it never reaches the gate.
- **`epicrun` differs on two points.** A stop that would end a `queue` parks one child instead and
  the run continues (`epicrun.md` → "park and continue"), and the keyword accepts an Issue that is
  **not** an epic — running it as a `fullrun`, and building the epic around it only if a prerequisite
  or a split turns up (`epicrun.md` → "When `#N` is not an epic"). Both follow from what the keyword
  authorizes: a batch, decided once at the start.
- **The split assessment** runs before any work starts, at *every* entry point, from the one
  definition in `split-assessment.md`. Two or more separately-mergeable deliverables always means an
  epic — no count threshold, no ordering condition — and a `fullrun` / `halfrun` that finds one files
  the epic and **stops** rather than widening its own authorization to a batch.
- **A prerequisite discovered mid-run is a dependency, not a park.** Finding that something else in
  *this* repository has to land first is a third situation, distinct from an upstream defect (file
  and stop) and from a split (file the epic and stop): the Issue in hand is still one deliverable, it
  just needs another one before it. Inside an `epicrun` it is filed without confirmation, recorded as
  a dependency, and the run **continues rather than parking it** (`epicrun.md` → "A prerequisite
  discovered mid-run"); inside a `fullrun` or `halfrun` the same filing happens without asking and
  the command then **stops**, leaving the person one command to type (`fullrun.md` / `halfrun.md`).
  **Automatic filing is capped at 10 Issues per run** at every entry point. `kickoff` is exempt — it
  never implements, so it never discovers one.
- **The two-layer work summary** is presented once per Issue immediately before implementation
  starts, including when the Issue body was already filled. `kickoff` is exempt: it posts a plan to
  the Issue instead.
- **Artifact prose** — Issue bodies, Issue/PR comments, Telegram bodies — is written in the session
  language (`JOSH_SESSION_LANG`, default `ja`). Issue and PR titles stay English.
- **A mid-workflow stop always sends a `confirmation` Telegram first**, so the user is alerted
  off-screen. The rule and its exact command stay resident in `CLAUDE.md` under
  "Mid-workflow stop notification", because most pauses that need it happen on
  turns where no workflow keyword was typed and this skill was never loaded. `halfrun.md` carries
  the one form specific to a command: the resume-command body of its stop before commit.

## 3. What stays resident, and what is read from here

**A rule stays in `CLAUDE.md` if and only if it has to fire on a turn where no skill was loaded.**
That is the whole test, and it has exactly one input: when does the rule first bind — before a
command has started, or after. Everything a run reaches only *after* it has read this skill is
routed to from `CLAUDE.md`, never restated there.

`CLAUDE.md` is the only document this section is about. `AGENTS.md` and `GEMINI.md` hold no rules at
all since joshuafolkken/kit#963 — they are pointers to it, so nothing can be resident in them.

### The second question: how much of a resident rule is resident

The criterion above decides **whether** a rule stays. It says nothing about **how much of it** stays,
and for a long time nothing did — so a rule that passed arrived with its whole procedure attached,
and `CLAUDE.md` grew back to within 585 bytes of its ceiling with the procedures already moved out
(joshuafolkken/kit#964).

**A resident rule is written as its trigger plus a pointer.** Two things and no third:

1. **The trigger** — the situation that fires it, and the one instruction that must be obeyed before
   anything else is read. Written so an agent that reads nothing further still does the safe thing:
   stops, files, refuses, asks.
2. **The pointer** — the topic file under `prompts/collaboration-workflow/` or the skill file that holds
   the procedure, named exactly enough to open without searching.

Everything else — the steps, the worked examples, the rationale, the failure it was written after —
belongs at the pointer. **The test is whether the resident text still produces correct behavior on a
turn where the pointer is never opened.** If dropping a sentence would let an agent proceed wrongly
rather than merely proceed less well informed, that sentence is part of the trigger. If dropping it
only costs context, it belongs at the pointer.

**Trimming is moving, never deleting.** Before a sentence leaves `CLAUDE.md` it has to exist at the
pointer, and the marker suite that pinned it has to be re-pointed there rather than dropped. A
canonical section that is thinner than the resident copy is the normal case, not a reason to delete
— the resident text is then the fuller version, and it is moved in before it is cut out.

**The scope of this list is every resident rule that has an on-demand counterpart** — a skill or an
on-demand prompt carrying the procedure the resident text routes to. Those are the rules the
criterion is *about*: each one could have moved, and stayed for a reason worth naming. Within that
scope the list is exhaustive, and a rule with a counterpart that is resident without appearing here
has not been checked.

Counting by skill would draw the line in the wrong place — `verify-ui` is routed to as readily as
this skill is, and one entry below routes to `prompts/review.md`, which is not a skill at all.

Outside the scope the documents carry a great deal more — the naming conventions, the quality
limits, the code-change rules, Package-First. **None of that belongs on this list**: there is no
on-demand copy for them to have moved to, so the question the criterion asks does not arise, and
their absence here is correct rather than an omission (joshuafolkken/kit#955).

Within that scope, every rule that passes the test is resident in full, and a marker suite asserts
each one present in `CLAUDE.md` — `scripts/workflow-skills.test.ts` for most of them,
`scripts/verify-ui-skill.test.ts` for the UI gate, and
`scripts/review-followup-bundle-document-rule.test.ts` for the follow-up filing step:

- **Explicit invocation required** — it decides whether a workflow starts at all, so it binds on the
  turn the user types the keyword, which is before anything here has been read.
- **The mid-workflow stop notification** — most pauses that need it (an upstream-Issue interrupt, a
  Tier C confirmation) happen on turns carrying no workflow keyword at all.
- **The `overrides` prohibition** and **the `devEngines` prohibition** — a dependency command can be
  run on any turn, including one that never loads `dependency-update`, and by the time the skill
  would be read the pin has already been rewritten.
- **The follow-up filing step after the review round cap** — filing the Issue and bundling it into an
  epic. A pre-commit self-review runs outside any workflow as readily as inside one, and the Issue it
  files is orphaned just the same; the step has to be readable on a turn that never typed a keyword.
  Its full form is in `prompts/review.md` → "Review round cap" (joshuafolkken/kit#946).
- **The UI-verification gate** — a rendered change is not done until the screen has been looked at,
  and the procedure for capturing it is `verify-ui`. The gate binds whenever a UI change is reported
  finished, which is routinely a turn with no workflow keyword typed and no skill loaded.
- **The three `josh epic:*` rules that bind outside those commands** — recording a decision removes
  that child's `needs-decision` label, fixing what `epic:audit` finds is Tier A, and an epic in
  another repository is referenced as `owner/repo#N`. Each fires on a turn where no `epic:*` command
  was run: the moment an issue is filed, or a decision written. The commands' own procedures are in
  `.claude/skills/epic-commands/`, which is where everything else about them lives.

These do not pass it, and live in a skill instead: the split assessment (`split-assessment.md`), a
prerequisite discovered mid-run (`fullrun.md` / `halfrun.md` / `epicrun.md`), `epicrun`'s acceptance
of an Issue that is not an epic and its park-and-continue behavior (`epicrun.md`), the whole
verification gate and merge chain (`chain-rule.md` / `followup.md`), and the post-update verification
procedure (`.claude/skills/dependency-update/`) that the two prohibitions above route to.

**The criterion is not advisory.** `scripts/workflow-skills.test.ts` caps each document at
`RESIDENT_CEILING_BYTES` and requires headroom under it, so a procedure restated resident costs
budget that the next genuinely-resident rule then has to take back out of existing prose. When a
rule is edited by deleting a neighboring sentence to keep a byte count, the deletion is chosen by
what was not pinned by a marker rather than by what matters (joshuafolkken/kit#951).
