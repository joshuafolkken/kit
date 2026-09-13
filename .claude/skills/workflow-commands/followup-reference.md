# `pnpm josh followup` — the post-execution reference

The parts of the `followup` procedure a run reaches **after** it has issued `pnpm josh followup`: how
to read the stage-timing block the command prints, the AI-reviewer comment scan and the config-file
report it runs, and the release ask that closes the completion summary. `followup.md` carries what a
run needs **before** it issues the command and points here for the rest, so the read that lands in the
turn that issues `pnpm josh followup` stays small (joshuafolkken/kit#1905).

This file is the single source of the sections below; `followup.md`, `fullrun.md`, `queue.md` and
`epicrun.md` point here rather than restating them.

## Reading the stage-timing block

### It prints how long each of those stages took

Since joshuafolkken/kit#1349 the command closes with one row per stage and a total, so "where did
`followup` spend its time" is read rather than guessed. The shape, with illustrative durations:

```
followup stage: closes-and-context        2.1 s
followup stage: checks-wait               28.4 s
followup stage: coderabbit-comments       1.3 s
followup stage: ai-review-comments        2.0 s
followup stage: telegram                  1.1 s
followup stage: merge                     2.6 s
followup stage: completion-and-epic-close 1.4 s
followup stages total:                    38.9 s
```

- **The block is printed on a failed run too**, up to and including the stage that threw, which is
  named `interrupted`. A `followup` that exits non-zero on an AI-review blocker or a red check is the
  invocation whose wait was longest, and one that printed nothing would leave the measurement blind to
  exactly those. **A short block there is the run stopping early, not the printer breaking**: the
  stages after the failure never ran, so they have no duration to report.
- **The `merge` row appears only on a run that merged**, so a `--no-merge` block is a row shorter.
- **Two rows say `and` because the requests behind them go out together** (joshuafolkken/kit#1446).
  `closes-and-context` is the former `closes-check` plus `context` — the pull request body, the
  repository name, the pull request URL and the issue title, four reads that need nothing from one
  another; `completion-and-epic-close` is the former `completion-comment` plus `epic-close`. A lap
  records an interval rather than a call, so a batch is one row, and the name is what says which
  stages it holds. **The one dependency inside the batch is kept**: with no issue number on the
  command line the title read waits for the body that names it, and only that read waits.
  **`checks-wait` is untouched**, which is the point — what was overlapped was never a wait.
- **The total is the sum of the stages, not the command's whole wall clock.** What sits outside it is
  the tail the workflow script runs afterwards — the run report, the review-record clears, the hold
  release, the next-issue listing and the version line — so a `pnpm josh time` reading of the same
  span is longer, and that gap is the tail. It is normally a second or two; a run whose record could
  not be written adds a Telegram round trip to it.
- **What was measured is on joshuafolkken/kit#1349**, and cutting any of it is deliberately not this
  block's business: the required-check wait and the AI-review scan are the merge gate, and narrowing
  either to make a number smaller is the workaround `CLAUDE.md` prohibits.

A `failure` Telegram is sent **by hand, exactly once**, and only when the agent has finally given up
recovering — never once per retry:

```bash
pnpm josh notify --task-type failure --issue-url "<issue-url>" --body "<the reason and what is unresolved>"
```

## AI reviewer comment scan (automatic in `pnpm josh followup`)

`pnpm josh followup` scans top-level PR comments from AI reviewers (Claude Review, CodeRabbit summary comments) **independently of CI status**. This scan runs after CI is green and after the existing CodeRabbit line-comment check. The goal is to ensure substantive findings posted by AI reviewers _after_ CI goes green are not silently shipped.

**Temporary (kit#753)**: while CodeRabbit reviews are slow, CodeRabbit is non-blocking end to end — it is excluded from the default required checks (restore via `JOSH_REQUIRED_CHECKS`), `Actionable comments posted: N` is downgraded to an informational log, and unresolved CodeRabbit line comments no longer require an ignore reason. Every skip is printed to the console and appended to the completion Telegram body. Claude Review blockers are unchanged. Revert together with kit#752.

- Blocker heuristics (conservative, structural — not NLP):
  - **Claude Review** (`author.login = claude`): body contains `### Issues`, `### Problem`, `#### Logic bug`, or a numbered finding heading like `### 1. ...`
  - **CodeRabbit** (`author.login = coderabbitai` / `coderabbitai[bot]`): body contains `Actionable comments posted: N` with N > 0. Rate-limit notices (`rate limited by coderabbit.ai` / `Rate limit exceeded`) and "No actionable comments" summaries are ignored.
- If blockers exist and **no** ignore reason is supplied: `pnpm josh followup` sends a `confirmation` Telegram and exits non-zero. Fix the findings (or provide an ignore reason) and re-run.
- If blockers exist and `--ai-review-ignore-reason "<reason>"` is supplied: the workflow posts an ignore-reason comment to the PR (mirroring the CodeRabbit ignore-reason flow) and proceeds to completion.
- Acknowledgment-only Claude comments (`All issues resolved ✓`, `Everything else looks good`) do not match the blocker heuristics, so rounds where the AI reviewer explicitly signs off do not trigger a false positive.
- **A comment listing that could not be read is treated exactly like a standing blocker.** A rate limit, expired auth, a dropped connection — every one of them used to arrive as an empty listing, so the gate passed without having read anything (joshuafolkken/kit#973). `confirmation` Telegram, non-zero exit, re-run once the read succeeds. `--ai-review-ignore-reason` still gets past it, because what it means is unchanged: a person has looked — and the run then carries an audit note saying the scan was bypassed.
- **The CodeRabbit line-comment listing is the exception**: unreadable there is reported as an audit note rather than blocking, because kit#753 has CodeRabbit not blocking the merge at all. That reader also answers unreadable when the PR number itself would not resolve, which the top-level scan never has to do. Revert with kit#752.

## Config file reporting (inside `pnpm josh followup`)

**Nothing here asks you to compare anything by eye** (joshuafolkken/kit#1578). `pnpm josh followup` reads the tracked branch diff itself and matches every changed path against everything `josh sync` distributes — the three lists `AI_COPY_FILES`, `AI_COPY_FILE_MAPPINGS`, `AI_COPY_DIRECTORIES`, plus `SYNCED_PATHS`, the destinations `sync` writes directly (`playwright.config.ts`, `eslint.config.js`, the rest).

**It stops nothing** (joshuafolkken/kit#1592). What it produces is a report: the claimed paths and the list that claimed each one go into **the completion notification and the completion report on the Issue**, and the run continues to the CI wait and the merge exactly as a run that distributes nothing does. A run passing `--no-merge` is not reported on, because nothing has been distributed yet.

**It was a confirmation stop until joshuafolkken/kit#1592, and measurement is what removed it rather than preference.** In kit the condition is nearly always true, because kit is the distribution source: every change to `CLAUDE.md`, to `prompts/`, to `.claude/skills/` or to the distributed part of `docs/` is by definition a change to a distributed path. Measured on `epicrun #1413`, **two of three children stopped here** — and in both, the distributed file was the one that child's own acceptance criteria had ordered changed. The gate was not catching an unintended edit; it was stopping the work, and ending unattended execution until a person retyped one command.

**There is deliberately no branch on which repository this is.** Stopping in a consumer project — where editing a distributed file really is the mistake `CLAUDE.md` → "Route distributed-doc / config changes upstream to kit" names, since the next `josh sync` overwrites it silently — while staying quiet in kit was weighed and rejected on joshuafolkken/kit#1592: it needs a distribution-source test this package does not have, no case is recorded of the gate having saved a consumer's work, and the report below reaches a consumer's reader just as well.

**The matching itself is unchanged, and so is the reason it is mechanical.** The instruction the mechanical read replaced was skipped in two runs out of three on the day it was measured, and one of those two could not have succeeded by eye at all: `AI_COPY_DIRECTORIES` holds directories, so a distributed path such as `.claude/skills/workflow-commands/epicrun.md` appears in no list textually.

```bash
pnpm josh sync:scope    # managed | clean, naming which list claimed each path; alias: josh sys
```

- **There is no flag to pass and nothing to approve.** `--managed-config-ignore-reason` is gone with the stop it existed to get past.
- This report is produced independently of AI reviewer comment scanning, which still stops the run on a standing blocker

## When `pnpm josh release` runs

**The release point is a position plus a command's answer, never a judgement** (joshuafolkken/kit#1582). joshuafolkken/kit#1169 took the version off the branch and put it behind one command a person types; nothing said *when* to type it, and because nothing fails when nobody does — CI green, every pull request merged, every Issue closed — 53 merges reached main unreleased and no consumer of this package saw one of them.

**The position: once per invocation, after the last merge.** Ask when `pnpm josh followup` has merged the last pull request *this invocation* authorized — a lone `fullrun`'s only one, a `queue`'s or an `epicrun`'s **last** child, never once per child. In a lane the parent asks it, in the primary checkout, after the last lane is closed. Asked per child it would cut a release in the middle of a batch whose remaining children are still moving main.

**The answer: `pnpm josh release:scope`.**

```bash
pnpm josh release:scope          # → required | skip | unknown ; alias: josh res
pnpm josh release:scope --json   # the same answer as one JSON object
```

| It answers | What it means                                                    | What the run does                                                               |
| ---------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `required` | main has taken at least one merge since the version last changed | Close the completion report with the release request, naming `pnpm josh release` |
| `skip`     | the count is zero — nothing is waiting to ship                    | Say so in one line and finish                                                     |
| `unknown`  | the count could not be read                                      | **Report it as `unknown`** — it is never read as `skip`                          |

**The threshold is one, and that is deliberate.** joshuafolkken/kit#1582's own complaint is that accumulating makes a single version larger and its contents harder to trace afterwards, so a release per invocation is the cadence rather than a compromise — and it is the cadence that already held while every child bumped, before joshuafolkken/kit#1486 removed that. What keeps it from firing per child is the position above, not a larger number.

**The run never types `pnpm josh release` itself.** That command opens a pull request of its own, merges it, and starts the tag → publish → `production` chain: outward-facing and effectively irreversible, so it is Tier C (`CLAUDE.md` → "Decision autonomy"). Typing `fullrun` authorizes merging *this Issue's* pull request and nothing past it. On `required` the run reports the request as its closing line and stops there; a person types the command in the primary checkout, on the default branch, with a clean tree.

**`pnpm josh release --dry-run` was checked first and does not answer this.** It refuses off the default branch and on a dirty working tree, and it counts against `HEAD` rather than `origin/<default>` — and every position above is a feature branch or a lane, which is exactly where it throws. So `release:scope` adds **no counting of its own**: it reads `git_followup_pending.read_pending`, the same fetch-then-count `pnpm josh followup` already uses for the Telegram line, and the two therefore cannot disagree.

**This section is the single source.** `fullrun.md`, `queue.md` and `epicrun.md` point here rather than restating it, and `docs/josh-commands.md` → "`josh release:scope`" documents the command itself.
