---
name: workflow-commands
description: The procedures for the Issue-driven shorthand commands `kickoff`, `fullrun`, `halfrun` and `backlogrun` — planning, implementation, the verification gate, unattended epic and backlog execution, the `/code-review` → `followup` chain rule, auto-merge and the Telegram notifications. Read this the moment the user types one of those keywords (with or without `#N` / `new`), before running any command, and read it too when asked what one of them does or when a run of one has to be resumed or repaired.
---

# Issue-driven workflow commands

`kickoff`, `fullrun`, `halfrun` and `backlogrun` are the shorthand commands this
package's collaboration workflow is built on. Their procedures live here rather than in `CLAUDE.md`
because each one applies only while its own command is running.

The canonical extended reference is `prompts/collaboration-workflow/` (indexed by
`prompts/collaboration-workflow.md`); this skill is the operational procedure, and the two must agree.

## 0. The rule that fires before any of them — explicit invocation

**Never start a `kickoff` / `halfrun` / `fullrun` / `backlogrun` workflow (including their
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

**A session cut inside a declared budget is not a new invocation.** A `backlogrun` that is cut and
resumed is still the one invocation a person typed — the keyword authorized the declared budget, and
the cut is an execution detail of spending it. What this rule forbids is _inferring_ a workflow from a
request's shape. **The reading covers `backlogrun` and it alone** — a `fullrun` cut still waits for
the keyword, because a `fullrun` ends at one issue and has nothing to carry.

**`backlogrun-steps.md` → "The session cut is inside the invocation" is the single source of the
mechanism** — the record, the two commands, and what each answer means, and how a named-issue
`backlogrun #N1 #N2 …` pins its list to what was typed while the issues it has finished live in the
record's `done` field rather than shrinking the string.

## 1. Which file to read

Read this file, then the one for the command that was typed. The command file is a **manifest** — the
ordered steps as terse triggers and pointers; `pnpm josh run:step <N>` prints the run's next single
action — computed from the event stream, the carry record and the issue state, never the conversation
(`run:next` is its pre-implementation degenerate form) — and each step's detail is read on demand from
the file its pointer names (for `fullrun`, the step lists are `fullrun-steps.md`).

| Typed keyword                            | Read                                        |
| ---------------------------------------- | ------------------------------------------- |
| `kickoff` / `kickoff #N` / `kickoff new` | `kickoff.md`                                |
| `fullrun` / `fullrun #N` / `fullrun new` | `fullrun.md`                                |
| `halfrun` / `halfrun #N` / `halfrun new` | `halfrun.md`                                |
| `backlogrun` / `backlogrun #N…` / `backlogrun #E…` | `backlogrun.md` — its dispatched child reads `fullrun.md` + `split-assessment.md` in its own unit, not the parent at entry |

Each command manifest cites `split-assessment.md` → "The question" — the split decision, read at the
entry as a section; the split-handling detail (what each entry does with the answer, promote or create
an epic) is read on demand only when a split is found (joshuafolkken/kit#2189). `backlogrun`'s row
lists `backlogrun.md` alone: its parent orchestrates and never implements, so `fullrun.md` and
`split-assessment.md` are read by a dispatched child in its own delegated unit (`backlogrun-child.md`).
Every procedure for *running* a `backlogrun` item — lanes (`backlogrun-lanes.md`), park-and-continue,
the guards — stays `backlogrun.md`'s. The on-demand sections `into-target.md` (an `into` suffix) and `target-repository.md`
(an `owner/repo#` prefix) are read only when their trigger is typed, and §3's residency procedure lives
in `rule-residency.md`, reached only when a rule is placed, moved or retired.

### The fetch is one `Read` call per file

**Fetch each file above with one `Read` call of its own — never `cat`, and never two of them in one
command.** The distributed `.claude/settings.json` caps a Bash result at `BASH_MAX_OUTPUT_LENGTH`
characters, and every document over it is handed back by `cat` as a middle-truncated preview, then
read a second time. `pnpm josh read:set [<keyword>]` prints the cap and marks every file that exceeds
it; `pnpm josh doc:read <file>` is the Bash-cap-safe whole-file read.

### Four documents are read at the point of use, not at the entry

**`followup.md`, `latest-gate.md`, `chain-rule.md` and `background-commands.md` are not entry reads.**
Each is fetched at its named scope, in the same turn, by the named command that has to obey it:

| Document                | Read it when                                                                   |
| ----------------------- | ------------------------------------------------------------------------------ |
| `latest-gate.md`        | `pnpm josh latest:scope` answers `required` — before `josh latest` runs         |
| `followup.md` → "Run `pnpm josh followup`" | Before issuing `pnpm josh followup`, in that same turn |
| `chain-rule.md` → "Run the review-to-merge chain" | Before the first `pnpm josh gate` launch (`fullrun` / `backlogrun`) — the section is how the gate starts, overlapped with the review, so it is read before the gate rather than before the `/code-review` step |
| `background-commands.md` → "Background the gate and push" | Before backgrounding `pnpm josh gate` — the first long-running command a run detaches (`fullrun` / `halfrun` / `backlogrun`) |

A `skip` answer from `latest:scope` reads nothing; `latest-gate.md` remains a whole-file read, while
the other three fetch only the operational section named above. The trigger sentence for each is
resident in §2 and in the command's manifest, so a run that never opens these documents still calls
the right command at the right moment. `followup.md`'s post-execution reference is in
`followup-reference.md`, reached through a section pointer from `followup.md`.

**A lane child that parks reads `backlogrun-park.md` → "park and continue" at that point of use**, so
the pointer names that heading rather than the whole file: the entry read is charged for the park
procedure alone, and the rest of `backlogrun-park.md` is read only when it is reached
(joshuafolkken/kit#2189).

### A section reference is read as a section

**A pointer written `` `X.md` → "Heading" `` is read as that section, never by opening `X.md` whole:**

```bash
pnpm josh doc:section <file.md> "<heading>"   # the section, verbatim ; alias: josh ds
pnpm josh read:set [<keyword>]                # what an entry reads, and what it costs ; alias: josh rs
```

The section is fetched in the same turn, printed verbatim with its subsections; **a heading that does
not resolve is refused, with the file's own headings listed**, as is an ambiguous prefix. The set is
derived from the table above and the documents themselves, not transcribed;
`scripts/document/entry-read-set.test.ts` pins the derivation and
`scripts/rules/entry-read-set-document-rule.test.ts` pins this rule.

## 2. What every one of them shares

Each shared rule is a **trigger, a one-line action, and the single source** the procedure is read
from. The single source is where the rule is stated in full — this list is the manifest, not the
procedure.

| Trigger | Action | Single source |
| --- | --- | --- |
| Before implementing (every implementing entry) | `pnpm josh latest:scope`; on `required` read the doc and run `josh latest`, then load the `dependency-update` skill; `kickoff` never reaches it | `latest-gate.md` (read whole, only on `required`) |
| Implementation is done | The verification gate: refactor → `pnpm josh main:merge` → `pnpm josh gate` started beside a subagent `/code-review` and joined before the commit → the two-round cap → PR opened between the rounds → merge; `kickoff` never reaches it | `chain-rule.md` → "Run the review-to-merge chain" |
| While implementing | Re-run one check by name, not the whole gate — `pnpm josh lint:related`, `pnpm josh cspell:dot`, `pnpm josh test:related`; the last pair runs in front of the gate, and `pnpm josh review:brief` refuses a brief on a tree neither was green on | `chain-rule.md` |
| A review has run | Its verdict counts only once `pnpm josh review:attest --check` answers `ok`; `missing` / `mismatch` are refusals `pnpm josh followup` blocks the merge on | `chain-rule.md` → "The brief names the checkout, and a review that read another one is refused" |
| E2E gate | The CI E2E job where the command ends in a PR (`fullrun` / `backlogrun`, enforced by `pnpm josh followup`); you run `pnpm josh test:e2e` yourself where it does not (`halfrun`) | `prompts/testing-guide.md` → "Closing the E2E gate without a human run" |
| A defect in the verification path turns up | The interrupt runs alone; a batch resumes only once it has merged — decided from an enumeration, not from how serious it looks | `prompts/collaboration-workflow/wip-cap.md` → 「実行のしかた」 |
| A command can take minutes | Issue it in the background; the turn never ends at the push (`pnpm josh followup` stays foreground) | §2h → `background-commands.md` → "Background the gate and push" |
| `pnpm josh issue:state <N>` answers `human_review: yes` | Implement and gate, then stop before the commit | §2z → `needs-human-review.md` |
| Under `backlogrun`, a stop that would end a batch, or a named non-epic item | Park one child and continue; run a named non-epic item as a `fullrun` | `backlogrun-park.md` → "park and continue"; `backlogrun-child.md` → "When `#N` is not an epic" |
| `backlogrun`'s authorization | The whole `auto-ok` opted-in pool as well as its named items; `pnpm josh backlog:next` offers them | `backlogrun.md` |
| First call of `fullrun` / `halfrun` (not `kickoff`) | Claim the tree: `fullrun #N` starts with `pnpm josh run:entry <N>` (which runs the hold); `fullrun new` and `halfrun` use `pnpm josh run:hold` | §2f → `working-tree-hold.md` |
| Same turn as the hold (not a dispatched child, not `kickoff`) | `pnpm josh cost --cut`; `under` continues, `over` stops with a `confirmation` Telegram and the resume command, then `pnpm josh run:release` | `backlogrun-progress.md` → "The hand-off" (shared 135,000 threshold) |
| Before any work starts (every entry) | The split assessment; the default is not to split — separability **and** a scope clearly over one gate must hold together; a `fullrun` / `halfrun` that finds a split files the epic and **stops** | `split-assessment.md` → "The question" |
| Another Issue here must land first | A prerequisite is a dependency, not a park (the third of four mid-run discoveries) | §2d → `prerequisite.md` |
| Something worth filing, none of the three | File it without asking (Tier A, first-party) and carry on; a delegated child returns it to the parent instead | §2i → `observation-filing.md` |
| `run:step` prints the retrospective step (a run drained its backlog and stopped, not a lane child) | Run what it prints once, file 0–2 improvements, then `pnpm josh run:carry --retrospective` | §2j → `retrospective.md` |
| The pre-implementation reading reaches 3 unedited files | Delegate it; a file this run will edit is read in the main line | §2b → "The pre-implementation reading" |
| Before implementing (every `#N` entry) | Read the Issue's comments — the later of a body and a comment wins | §2g → `issue-comments.md` |
| Immediately before implementation | Present the two-layer work summary (once per Issue); `kickoff` posts a plan instead | `prompts/collaboration-workflow/report-format.md` |
| Any artifact prose (Issue bodies, comments, Telegram) | Session language (`JOSH_SESSION_LANG`, default `ja`); Issue/PR titles stay English | `prompts/collaboration-workflow/overview.md` |
| Any mid-workflow stop | Send a `confirmation` Telegram first, so the user is alerted off-screen | `CLAUDE.md` → "Mid-workflow stop notification" |

## 2z. `needs-human-review` — the child that stops before its commit

**Trigger:** `pnpm josh issue:state <N>` answers `human_review: yes` — asked once, before implementing.
**Then:** implement and run the verification gate normally, but commit nothing — leave the tree
uncommitted and unstashed, send a `confirmation` Telegram with the resume command, and stop the whole
run (inside a `backlogrun` this is the one child stop that is *not* park-and-continue). **The label is
applied only by a person; never apply or remove it.** The full procedure — why it stops the *end* not
the *start*, why the repository stays held, and the resume — is `needs-human-review.md`, its single
source, read at that trigger.

## 2a. The `into <target>` suffix — where the new Issue lands

**The suffix and its procedure are `into-target.md`, read at its point of use — the moment a `new`
entry (`kickoff new` / `fullrun new` / `halfrun new`) is typed with an `into <target>` suffix.** It
names the epic the run's artifact joins, inserts it with `pnpm josh epic --add <E> <N>` as soon as the
artifact exists, and refuses a target that is not an epic. A run given a `#N` or a bare `new` never
reaches it. `into-target.md` is the single source.

## 2b. Delegating a step to a cheaper tier

**Before delegating any run step, ask `pnpm josh delegate <step>`; never decide eligibility yourself.**
Read `delegation.md` at the first delegation decision for its units and verification rules. An item
absent from the enumeration stays in the main line. A dispatched `epic-child` that returns open with
`human_review: yes` is an authorized stop, not a failed child (§2z).

### The pre-implementation reading — what goes to a unit, and from which file

**When the next pre-implementation read would reach 3 files this run will not edit, delegate the
unread investigation before that read.** Keep edit-target reads in the main line. The full procedure
and the `file:line` verification are in `delegation.md` → "The pre-implementation reading"; the
threshold is counted by `pnpm josh investigation:guard`.

## 2c. The `owner/repo#` prefix — which repository the run acts on

**The prefix and its procedure are `target-repository.md`, read at its point of use — the moment an
entry is typed with an `owner/repo#` prefix or a short `repo#` name.** It names the repository the run
acts on; a short name expands by the session owner and is first-party by construction, an explicit
foreign owner is a third-party target that stops the run, and an implementing entry resolves that
repository's checkout from `pnpm josh doctor` rather than cloning. No prefix leaves the target as the
session's own repository, so a run without one never reaches it. `target-repository.md` is the single
source.

## 2d. A prerequisite discovered mid-run — a dependency, not a park

**Trigger:** a run finds that another Issue in *this* repository has to land first. **Then:** it is
still one deliverable with another in front of it — file the prerequisite with the `route:tier-a` label
(scouted first, §2e), stash the work in progress with `git stash push -u` and record it on the Issue,
record the dependency in the epic, and — under `fullrun` / `halfrun` — **stop**, or — under
`backlogrun` — **continue** (`backlogrun-park.md` → "A prerequisite discovered mid-run"). It is the
third of four mid-run discoveries, distinct from an upstream defect, a split (`split-assessment.md`)
and an observation (§2i). The full table, the filing command, the `-u`/`stash:pop` steps and the
10-per-run cap are `prerequisite.md`, its single source, read at that trigger. **When the prerequisite
is the run's second filing, `pnpm josh issue:fold` runs first** (§2e), and `pnpm josh rule:guard`
refuses the second `gh api … issues` call until it has.

## 2e. Before filing a new Issue — `pnpm josh issue:scout`

**Before every new Issue is filed, run `pnpm josh issue:scout <title>` and read its duplicate and epic
answers.** This applies inside every workflow, including observations and review follow-ups. The
guard refuses a filing without it. Read `issue-scout.md` at that point for the duplicate, closed-Issue
and epic decisions; `issue-fold-existing.md` handles a compatible duplicate. `docs/josh-commands.md`
→ "`josh issue:scout`" defines the command's output.

## 2f. The working-tree hold — one run per tree

**Trigger:** the first call of `fullrun` and `halfrun` alike — before the title is normalized, before
`git switch main`, and before a `new` entry files its Issue. **Then:** `fullrun #N` first runs
`pnpm josh run:entry <N>`, which includes the tree claim; `fullrun new` and `halfrun` first run
`pnpm josh run:hold [<N>]`. `hold` continues; `busy` and `unknown` stop with a `confirmation` Telegram
carrying what stderr printed. **`kickoff` is exempt** (it edits nothing). A stop that leaves the tree
clean releases explicitly with `pnpm josh run:release [<N>]`; a `halfrun` or `needs-human-review` stop
keeps the hold; `pnpm josh followup` releases a merged run. The answer table, the per-child rule and
the `--force` spelling are `working-tree-hold.md`, its single source, read at that trigger.

## 2g. An Issue's comments are part of the Issue

**Trigger:** before implementing at every `#N` entry point (`fullrun`, `halfrun`, `kickoff`, and each
`backlogrun` child in its own unit). **Then:** `pnpm josh issue:read <N> [<N> ...]` reads the body and
the comments in one call — a decision recorded after the body was written lives only in a comment, and
of a body and a comment that disagree the later text wins. Two comment kinds are not the run's to act
on blindly — a scope reassigned to another Issue, and an Issue already merged (the `already-done`
exit) — and both, the long-thread delegation and why `pnpm josh rule:guard` refuses the body-only read,
are `issue-comments.md`, its single source, read at that trigger.

## 2h. A command that can take minutes is issued in the background

**Trigger:** before backgrounding the first long-running command (`pnpm josh gate`). **Then:** issue
`pnpm josh git -y`, `pnpm josh gate` and the CI wait detached while `pnpm josh followup` stays in the
foreground — the turn never ends at the push, bar a dispatched lane child's pre-gate cut
(`pre-gate-cut.md`). A parent waiting on its children is the same rule at the batch's scale: a
background command's completion re-invokes the session, so the `backlogrun` loop starts no sleep of
its own. The single source is `background-commands.md` → "Background the gate and push", with the
parent-wake half at `backlogrun-progress.md` → "The parent keeps no clock of its own".

## 2i. An observation worth filing is filed without asking

**When a first-party observation is worth filing, file it without asking and continue the run.**
Read `observation-filing.md` in full before filing: it decides the depth test, filing ceilings, labels,
second-filing fold, ledger fallback and delegated-child handoff. Use `pnpm josh repo:party` to decide
first-party status, then run `pnpm josh issue:scout` before filing (§2e). A third-party target remains
Tier C (`CLAUDE.md`).

## 2j. The end-of-run retrospective — read when `run:step` prints it

**When `pnpm josh run:step` prints the retrospective step, read `retrospective.md` in full and run the
digest it names once.** File up to two worthwhile improvements through `issue:scout` and
`epic:bundle`, stack the rest in the observation ledger, and close the step with the command described
there. A dispatched lane child never runs the retrospective.

## 3. What stays resident, and what is read from here

**The residency criterion and its procedure are `rule-residency.md`, read only when a rule is being
placed, moved or retired — never at any entry, and never during a run.** It carries question 0 (is the
answer computable from mechanically readable inputs, so it is a decision oracle — `pnpm josh
oracle:list`), the ordering question (does it decide *when or in what order* rather than *what*, so it
goes in the run driver `pnpm josh run:step` — `prompts/collaboration-workflow/residency.md` → ordering
question), the first question (can the trigger be named as one tool call, so the body moves out of
`CLAUDE.md` to a hook via `prompts/collaboration-workflow/rule-delivery.md`), the second question
(does it have to fire on a turn where no skill was loaded, so it stays in `CLAUDE.md`), and the
procedure that decides how much of a resident rule is resident — the trigger-plus-pointer shape, the
enumeration of every resident rule with an on-demand counterpart, and the retirement route and its
three tests. `rule-residency.md` is the single source; the moment it binds is a turn spent editing
these documents, never a turn spent executing an Issue.
