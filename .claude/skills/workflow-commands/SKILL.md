---
name: workflow-commands
description: The procedures for the Issue-driven shorthand commands `kickoff`, `fullrun`, `halfrun`, `queue` and `epicrun` — planning, implementation, the verification gate, unattended epic execution, the `/code-review` → `followup --merge` chain rule, auto-merge and the Telegram notifications. Read this the moment the user types one of those keywords (with or without `#N` / `new`), before running any command, and read it too when asked what one of them does or when a run of one has to be resumed or repaired.
---

# Issue-driven workflow commands

`kickoff`, `fullrun`, `halfrun`, `queue` and `epicrun` are the shorthand commands this package's
collaboration workflow is built on. Their procedures live here rather than in `CLAUDE.md` /
`AGENTS.md` / `GEMINI.md` because each one applies only while its own command is running — keeping
them resident spent context on every turn to describe a workflow most turns never enter.

The canonical extended reference is `prompts/collaboration-workflow.md`; this skill is the
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
| `epicrun #E`                             | `epicrun.md` + `fullrun.md` + `chain-rule.md` + `followup.md` |

## 2. What every one of them shares

- **The verification gate**, in this order: refactor per `prompts/refactoring.md` → `pnpm josh lint`
  → `pnpm exec tsc --noEmit` → `pnpm josh cspell:dot` → `pnpm josh test:unit` → `/code-review medium`
  on `git diff main`, iterating until no high/medium findings remain — **at most two reviews in total**
  (`prompts/review.md` → "Review round cap"). `kickoff` is the exception —
  it never implements, so it never reaches the gate.
- **`epicrun` differs on one point only**: a stop that would end a `queue` parks one child instead
  and the run continues. See `epicrun.md` → "park and continue".
- **The split assessment** runs before any work starts, at *every* entry point, from the one
  definition in `split-assessment.md`. Two or more separately-mergeable deliverables always means an
  epic — no count threshold, no ordering condition — and a `fullrun` / `halfrun` that finds one files
  the epic and **stops** rather than widening its own authorization to a batch.
- **The two-layer work summary** is presented once per Issue immediately before implementation
  starts, including when the Issue body was already filled. `kickoff` is exempt: it posts a plan to
  the Issue instead.
- **Artifact prose** — Issue bodies, Issue/PR comments, Telegram bodies — is written in the session
  language (`JOSH_SESSION_LANG`, default `ja`). Issue and PR titles stay English.
- **A mid-workflow stop always sends a `confirmation` Telegram first**, so the user is alerted
  off-screen. The rule and its exact command stay resident in `CLAUDE.md` / `AGENTS.md` /
  `GEMINI.md` under "Mid-workflow stop notification", because most pauses that need it happen on
  turns where no workflow keyword was typed and this skill was never loaded. `halfrun.md` carries
  the one form specific to a command: the resume-command body of its stop before commit.
