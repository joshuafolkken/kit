---
name: workflow-commands
description: Procedures for `kickoff`, `fullrun`, `halfrun`, `prrun` and `backlogrun`. Read it the moment one is typed (with or without `#N` / `new`), before any command, and when asked what one does or a run must be resumed or repaired.
---

# Issue-driven workflow commands

`kickoff`, `fullrun`, `halfrun`, `prrun` and `backlogrun` are the shorthand commands this
package's collaboration workflow is built on. **This file is their manifest — triggers and pointers,
never a procedure**: each rule is stated once, in the file its row names. History:
`docs/maintainers/workflow-commands-rationale.md` → "Where each rule came from".

## 0. The rule that fires before any of them — explicit invocation

Its single source is `CLAUDE.md` → "Explicit invocation required (MANDATORY)", resident because it
holds when this skill is not loaded. **A session cut inside a declared budget is not a new invocation — for `backlogrun`
alone**: `backlogrun-steps.md` → "The session cut is inside the invocation".

## 1. Which file to read

Read this file, then the files the typed command's row names. A command file is a **manifest** of
terse triggers and pointers; `pnpm josh run:step <N>` prints the run's next single action, computed
from the event stream, the carry record and the issue state, never the conversation.

| Typed keyword                            | Read                                        |
| ---------------------------------------- | ------------------------------------------- |
| `kickoff` / `kickoff #N` / `kickoff new` | `kickoff.md`                                |
| `fullrun` / `fullrun #N` / `fullrun new` | `fullrun.md` + `entry-sequence.md`          |
| `halfrun` / `halfrun #N` / `halfrun new` | `halfrun.md` + `entry-sequence.md`          |
| `prrun` / `prrun #N` / `prrun new`       | `prrun.md` — the difference over `fullrun.md`, read with it and `entry-sequence.md` |
| `backlogrun` / `backlogrun #N…` / `backlogrun #E…` | `backlogrun.md` — its dispatched child reads `fullrun.md` + `split-assessment.md` in its own unit, not the parent at entry |

`entry-sequence.md` holds the entry sequence and stop branches `fullrun`, `halfrun` and `prrun` share;
each manifest carries only its difference. `split-assessment.md` → "The question" is read at the
entry as a section, its split-handling detail only when a split is found.

### The fetch is one `Read` call per file

**Fetch each file above with one `Read` call of its own — never `cat`, never two in one command.** A
Bash result is capped at `BASH_MAX_OUTPUT_LENGTH` characters and truncates a longer document;
`pnpm josh doc:read <file>` is the cap-safe whole-file read.

### Four documents are read at the point of use, not at the entry

**`followup.md`, `latest-gate.md`, `chain-rule.md` and `background-commands.md` are not entry reads.**
Each is fetched at its named scope, in the same turn, by the named command that has to obey it:

| Document                | Read it when                                                                   |
| ----------------------- | ------------------------------------------------------------------------------ |
| `latest-gate.md`        | `pnpm josh latest:scope` answers `required` — before `josh latest` runs         |
| `followup.md` → "Run `pnpm josh followup`" | Before issuing `pnpm josh followup`, in that same turn |
| `chain-rule.md` → "Run the review-to-merge chain" | Before the first `pnpm josh gate` launch (`fullrun` / `prrun` / `backlogrun`) — the gate overlaps the review, so the section is read before it |
| `background-commands.md` → "Background the gate and push" | Before backgrounding `pnpm josh gate` — the first long-running command a run detaches (`fullrun` / `halfrun` / `prrun` / `backlogrun`) |

A `skip` answer from `latest:scope` reads nothing. **A lane child that parks reads
`backlogrun-park.md` → "park and continue" at that point of use**, and **every implementing run reads
`progress-watcher.md` → "Progress while the run is quiet"** before starting `pnpm josh run:progress
--wait` once its hold is claimed.

### A section reference is read as a section

**A pointer written `` `X.md` → "Heading" `` is read as that section, never by opening `X.md` whole:**

```bash
pnpm josh doc:section <file.md> "<heading>"   # the section, verbatim
pnpm josh read:set [<keyword>]                # what an entry reads, and what it costs
```

A heading that does not resolve is refused, with the file's own headings listed.

## 2. What every one of them shares

Each shared rule is a **trigger, a one-line action, and the single source** the procedure is read
from — read at that trigger, never restated here.

| Trigger | Action | Single source |
| --- | --- | --- |
| First call of any entry | `#N`: `pnpm josh run:entry <N> --to <command>` (claims the tree, except `kickoff`); `new` (not `kickoff`): `pnpm josh run:hold`; `busy` / `unknown` stop | `working-tree-hold.md` |
| `run:entry` prints its stage line | The command sets how far a run goes, the Issue where it starts; **`start: reached` redoes nothing** — stop (at `merged`, the next line answers) | `docs/how-to/run-issues.md` |
| Same turn as the hold (not a dispatched child, not `kickoff`) | `pnpm josh cost --cut`; `under` continues, `over` stops — `run:entry` notifies and runs `run:release` (by hand for `new`) | `backlogrun-progress.md` → "The hand-off" (shared 135,000 threshold) |
| An entry typed with an `owner/repo#` prefix or a short `repo#` name | Resolve the target and its checkout; an explicit foreign owner stops the run | `target-repository.md` |
| A `new` entry typed with an `into <target>` suffix | Insert the artifact into the named epic with `pnpm josh epic --add <E> <N>` | `into-target.md` |
| Before any work starts (every entry) | The split assessment; the default is not to split — separability **and** a scope clearly over one gate must hold together; a `fullrun` / `halfrun` that finds a split files the epic and **stops** | `split-assessment.md` → "The question" |
| Before implementing (every `#N` entry) | `pnpm josh issue:read <N>` — the body and the comments; the later of a body and a comment wins | `issue-comments.md` |
| `pnpm josh issue:state <N>` answers `human_review: yes` | Implement and gate, then stop before the commit; the label is applied only by a person | `needs-human-review.md` |
| Before implementing (every implementing entry) | `pnpm josh latest:scope`; on `required` read the doc and run `josh latest`, then load the `dependency-update` skill; `kickoff` never reaches it | `latest-gate.md` (read whole, only on `required`) |
| Before delegating any run step | `pnpm josh delegate <step>` decides eligibility, never you | `delegation.md` |
| The pre-implementation reading reaches 3 unedited files | Delegate the unread investigation; a file this run will edit is read in the main line | `delegation.md` → "The pre-implementation reading" |
| Immediately before implementation | Present the two-layer work summary (once per Issue); `kickoff` posts a plan instead | `prompts/collaboration-workflow/report-format.md` |
| While implementing | Re-run one check by name, not the whole gate — `pnpm josh lint:related`, `pnpm josh cspell:dot`, `pnpm josh test:related`; `pnpm josh review:brief` refuses a brief on a tree the last two were not green on | `chain-rule.md` |
| Implementation is done | Refactor → `pnpm josh main:merge` → `pnpm josh gate` beside a subagent `/code-review`, joined before the commit → round cap → PR → merge | `chain-rule.md` → "Run the review-to-merge chain" |
| A review has run | Its verdict counts only once `pnpm josh review:attest --check` answers `ok`; `missing` / `mismatch` are refusals `pnpm josh followup` blocks the merge on | `chain-rule.md` → "The brief names the checkout, and a review that read another one is refused" |
| A command can take minutes | Issue it in the background; the turn never ends at the push (`pnpm josh followup` stays foreground) | `background-commands.md` → "Background the gate and push" |
| E2E gate | The CI E2E job where the command ends in a PR (`fullrun` / `prrun` / `backlogrun`, enforced by `pnpm josh followup`); you run `pnpm josh test:e2e` yourself where it does not (`halfrun`) | `prompts/testing-guide.md` → "Closing the E2E gate without a human run" |
| Filing any new Issue | `pnpm josh issue:file` — it runs the `issue:scout` scan first; read its duplicate and epic answers | `issue-scout.md` |
| Another Issue here must land first | A prerequisite is a dependency, not a park — file it, stash, record the dependency; `fullrun` / `halfrun` stop, `backlogrun` continues | `prerequisite.md` |
| Something worth filing, none of the three | Unattended: file it (Tier A, first-party); else ask; a delegated child returns it to the parent instead | `observation-filing.md` |
| A defect in kit's own verification turns up | It runs alone when all three conditions hold; a batch resumes once it merges | `backlogrun-lanes.md` → "A solo run" |
| Under `backlogrun`, a stop that would end a batch, or a named non-epic item | Park one child and continue; run a named non-epic item as a `fullrun` | `backlogrun-park.md` → "park and continue"; `backlogrun-child.md` → "When `#N` is not an epic" |
| `backlogrun`'s authorization | The whole `auto-ok` opted-in pool as well as its named items; `pnpm josh backlog:next` offers them | `backlogrun.md` |
| `run:step` prints the retrospective step (a run drained its backlog and stopped, not a lane child) | Run what it prints once, file 0–2 improvements, then `pnpm josh run:carry --retrospective` | `retrospective.md` |
| Any artifact prose (Issue bodies, comments, Telegram) | Session language (`JOSH_SESSION_LANG`, default `ja`); Issue/PR titles stay English | `prompts/collaboration-workflow/overview.md` |
| Any mid-workflow stop | Send a `confirmation` Telegram first, so the user is alerted off-screen | `CLAUDE.md` → "Mid-workflow stop notification" |

## 3. What stays resident, and what is read from here

**The residency criterion is `prompts/collaboration-workflow/residency.md`, its single source — read
only when a rule is placed, moved or retired, never during a run.** Its questions — question 0
(`pnpm josh oracle:list`), the ordering question (`pnpm josh run:step`), the first and the second —
are asked there in order; none is restated here.
