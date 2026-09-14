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

**`backlogrun.md` → "The session cut is inside the invocation" is the single source of the
mechanism** — the record, the two commands, and what each answer means, and how a named-issue
`backlogrun #N1 #N2 …` pins its list to what was typed while the issues it has finished live in the
record's `done` field rather than shrinking the string.

## 1. Which file to read

Read this file, then the one for the command that was typed. `fullrun` and
`backlogrun` also obey `chain-rule.md`, but at a point of use rather than at the entry (see "Four
documents are read at the point of use" below). `halfrun` and `kickoff` never reach it — `halfrun`
stops before the commit, and `kickoff` never implements.

| Typed keyword                            | Read                                        |
| ---------------------------------------- | ------------------------------------------- |
| `kickoff` / `kickoff #N` / `kickoff new` | `kickoff.md` + `split-assessment.md`        |
| `fullrun` / `fullrun #N` / `fullrun new` | `fullrun.md` + `split-assessment.md`        |
| `halfrun` / `halfrun #N` / `halfrun new` | `halfrun.md` + `split-assessment.md`        |
| `backlogrun` / `backlogrun #N…` / `backlogrun #E…` | `backlogrun.md` + `split-assessment.md` + `fullrun.md` |

### The fetch is one `Read` call per file

**Fetch each file above with one `Read` call of its own — never `cat`, and never two of them in one
command.** The distributed `.claude/settings.json` caps a Bash result at `BASH_MAX_OUTPUT_LENGTH`
characters, and every document in this set is larger than that cap, so a `cat` hands back a
middle-truncated preview rather than the file, and a truncated fetch produces a run that has read its
instructions only partly and cannot tell which part. `pnpm josh read:set [<keyword>]` prints the cap
and marks every file that exceeds it.

### Four documents are read at the point of use, not at the entry

**`followup.md`, `latest-gate.md`, `chain-rule.md` and `background-commands.md` are not entry reads.**
Each is fetched **in full, in the same turn, by the step that has to obey it** — and that step is a
named command, so there is no judgement about when:

| Document                | Read it when                                                                   |
| ----------------------- | ------------------------------------------------------------------------------ |
| `latest-gate.md`        | `pnpm josh latest:scope` answers `required` — before `josh latest` runs         |
| `followup.md`           | Before issuing `pnpm josh followup`, in that same turn                          |
| `chain-rule.md`         | Before running the `/code-review` step (`fullrun` / `backlogrun`) |
| `background-commands.md` | Before backgrounding `pnpm josh gate` — the first long-running command a run detaches (`fullrun` / `halfrun` / `backlogrun`) |

This is "read it at the point of use", not "read it later": the fetch is whole and it happens before
the command it governs. A `skip` answer from `latest:scope` reads nothing; the other three have no
skip, so they are read when their step arrives. **The trigger sentence for each of the four is
resident in §2 and in the command's own file**, so a run that never opens these documents still calls
the right command at the right moment. `followup.md`'s post-execution reference — the stage-timing
block, the AI-reviewer comment scan, the config-file report and the release ask — is in
`followup-reference.md`, reached through a section pointer from `followup.md` when a run gets there.

### A section reference is read as a section

**A pointer written `` `X.md` → "Heading" `` is read as that section, never by opening `X.md` whole:**

```bash
pnpm josh doc:section <file.md> "<heading>"   # the section, verbatim ; alias: josh ds
pnpm josh read:set [<keyword>]                # what an entry reads, and what it costs ; alias: josh rs
```

The section is fetched in the same turn, by the main line that has to obey it, and printed verbatim
with its subsections — what changes is the extent of the fetch, never whether it happens. **A heading
that does not resolve is refused, with the file's own headings listed**, and **an ambiguous prefix is
refused too** rather than handing back whichever section came first. The set is derived from the table
above and the documents themselves, not transcribed; `scripts/document/entry-read-set.test.ts` pins
the derivation and `scripts/rules/entry-read-set-document-rule.test.ts` pins this rule.

**`backlogrun` reads `backlogrun.md` too, and that is the point rather than an omission.** It changes
only which issues are offered and by what authorization; every procedure for *running* one of them —
lanes, park-and-continue, the `needs-human-review` stop, a prerequisite discovered mid-run, the
delegated unit, the preflight, the progress watcher, the hand-off check and the guards — stays
`backlogrun.md`'s and is referenced from `backlogrun.md` rather than restated there.

## 2. What every one of them shares

- **The dependency update is asked for, not assumed.** Every implementing entry runs
  `pnpm josh latest:scope` before it implements and runs `josh latest` only on `required` — the
  trigger is elapsed time since the last update in this checkout, never a judgement, and the
  `dependency-update` skill is loaded afterwards whenever the update actually ran. `latest-gate.md` is
  the single source, **read in full in the turn `latest:scope` answers `required` and not before**;
  `kickoff` never reaches it, because it never implements.
- **The verification gate.** The full procedure — refactor, `pnpm josh main:merge`, `pnpm josh gate`
  started beside a subagent `/code-review` and joined before the commit, the two-round cap, the pull
  request opening between the rounds, and the merge — is single-sourced in `chain-rule.md`
  (`fullrun.md` carries the same order for its own entry). The essentials that bind here:
  - **Refactor first** (per `prompts/refactoring.md`), then **merge `origin/main` into the branch with
    `pnpm josh main:merge`** so the gate verifies the tree that will merge.
  - **`pnpm josh gate` (lint, type check, spell check and unit tests, run concurrently) is started
    when the review starts and joined before the commit** — neither writes to the working tree, so
    running them one after the other is pure waiting. **There is no path to a commit on a gate nobody
    read**: a red gate is fixed and re-run whatever the review concluded.
  - **The review is a subagent running `/code-review`** with the brief `pnpm josh review:brief` prints
    (the level, what the gate has already proved or is still proving on this tree, and the target) on
    `git diff main`, iterating until no high/medium findings remain — **at most two reviews in total**,
    the second a verification pass over the fixes (`prompts/review.md` → "Review round cap"). Whether a
    second round is due is `pnpm josh review:round2 --round-1-closed`'s answer, never a judgement.
  - **The gate is started once per run, not once per edit**: while implementing, re-run the single
    check by name — `pnpm josh lint:related`, `pnpm josh cspell:dot`, `pnpm josh test:related` (the
    scoped unit check) or the project's own type check — rather than the whole gate, and a single check
    answers once per tree. The last of those scoped checks runs on the last edit, in front of the gate
    and the review: `pnpm josh lint:related && pnpm josh test:related`, one call, and `pnpm josh
    review:brief` refuses a brief on a tree neither has been green on.
  - `kickoff` is the exception — it never implements, so it never reaches the gate.
  - **E2E closes after the review, and never by asking the user**: where the command ends in a pull
    request (`fullrun` / `backlogrun`) the CI E2E job is the result and `pnpm josh followup`
    enforces it; where it does not (`halfrun`), you run `pnpm josh test:e2e` yourself before the stop
    (`CLAUDE.md` → "Completion gate"; `prompts/testing-guide.md` → "Closing the E2E gate without a
    human run").
- **A review's verdict counts only once `pnpm josh review:attest --check` answers `ok`**, because
  `/code-review` is forked into the session's checkout rather than the run's: in a lane it can read a
  tree holding the previous child's already-merged code, find nothing wrong, and have that silence
  read as a clean round. `pnpm josh review:brief` names the checkout and prints the nonce the review
  attests with; `missing` and `mismatch` are both refusals, and `pnpm josh followup` refuses the merge
  on either (`chain-rule.md` → "The brief names the checkout, and a review that read another one is
  refused").
- **An interrupt whose subject is a defect in the verification path runs alone**, and a batch resumes
  only once it has merged — decided from an enumeration (the verification gate, the code review, the
  pre-push hook, the merge checks) rather than from how serious the defect looks. It binds wherever
  children are dispatched, so `backlogrun-lanes.md` → "Lanes" carries it for the parallel case and
  `prompts/collaboration-workflow/wip-cap.md` → 「実行のしかた」 is the single source.
- **A command that can take minutes is issued in the background, and the turn never ends at the
  push** — §2h. `pnpm josh followup` is the one that stays in the foreground, because nearly every
  step after it reads its result.
- **A child carrying `needs-human-review` stops the run before its commit**, at every entry point —
  §2z. It is the one *child's* stop a `backlogrun` does not turn into a park.
- **A named epic under `backlogrun` differs on two points from a single-issue item.** A stop that
  would otherwise end a batch parks one child and the run continues (`backlogrun-park.md` → "park and
  continue"), and a named item accepts an Issue that is **not** an epic — running it as a `fullrun`,
  and building an epic around it only if a prerequisite or a split turns up (`backlogrun-child.md` → "When
  `#N` is not an epic"). Both follow from what the keyword authorizes: a batch, decided once at the
  start.
- **`backlogrun` authorizes the whole opted-in pool as well as its named items.** Beyond the named
  Issues and epics, it authorizes every issue a person has opted in with `auto-ok` rather than one
  epic's children, so what changes across its argument forms is which issues are offered — by
  `pnpm josh backlog:next` — and nothing about how one of them is run (`backlogrun.md`). Membership
  stays a person's to decide.
- **The working-tree hold is claimed before anything else** — `pnpm josh run:hold`, at every typed
  entry point that edits the tree, ahead of the split assessment and ahead of a `new` entry's filing.
  **`kickoff` is exempt**: it edits nothing, so it neither claims nor releases. §2f.
- **The session boundary is asked at the entry as well, not only after a merge** —
  `pnpm josh cost --over 300000`, in the same turn as `pnpm josh run:hold` and before anything else is
  started, so a session already carrying an earlier Issue's whole conversation is cut before it pays
  for one more. It is the same rule at a second application point, and `backlogrun-progress.md` → "The hand-off" is
  the single source of the check and of where 300,000 comes from (a temporary experiment rather than a
  settled number). `under`, and the run continues. `over` — or a run the check could not answer for —
  and the run **stops before the work starts**: send a `confirmation` Telegram carrying the figure
  printed on standard error and the resume command — the invocation as it was typed, in a fresh
  session (`fullrun #<N>` / `halfrun #<N>` for a `#N` entry, `fullrun new` / `halfrun new` for a `new`
  one) — then run `pnpm josh run:release <N>` (bare where the entry is a `new` one) and stop. **A
  dispatched child does not ask it**: a `backlogrun` already owns this question at its own seam.
  `kickoff` is exempt, because it never implements.
- **The split assessment** runs before any work starts, at *every* entry point, from the one
  definition in `split-assessment.md`. **The default is not to split**: separability and a scope that
  clearly exceeds what one verification gate can confirm in one pass — the guide is about 10 changed
  files and about 400 changed lines — have to hold **together**, and either alone leaves the work as
  one Issue. Where both hold, two or more separately-mergeable deliverables always means an epic — no
  count threshold, no ordering condition — and a `fullrun` / `halfrun` that finds one files the epic
  and **stops** rather than widening its own authorization to a batch.
- **A prerequisite discovered mid-run is a dependency rather than a park**, at every entry point —
  §2d. It is the third thing a run can discover, beside an upstream defect and a split.
- **An observation worth filing is filed without asking, and the run carries on** — §2i. It is the
  fourth thing a run can discover and the only one that changes nothing about the Issue in hand. A
  filing at depth 1 or deeper cites the depth-0 work it blocked, and **a delegated child does not take
  this route at all** — it returns the observation to the parent.
- **The pre-implementation reading goes to a delegated unit once the count of subject files reaches
  the threshold §2b names** — §2b → "The pre-implementation reading". Understanding the Issue's
  subject is delegated; a file this run will edit is read in the main line; what comes back is the
  conclusion plus its `file:line` citations rather than the text.
- **An Issue's comments are read before implementing, at every `#N` entry point** — §2g. An agreement
  recorded after the body was written lives only in a comment, and between a body and a comment that
  disagree the later text is the one in force. `pnpm josh rule:guard` refuses the body-only read once
  per run and states the reissue there.
- **The two-layer work summary** is presented once per Issue immediately before implementation starts,
  including when the Issue body was already filled. `kickoff` is exempt: it posts a plan to the Issue
  instead.
- **Artifact prose** — Issue bodies, Issue/PR comments, Telegram bodies — is written in the session
  language (`JOSH_SESSION_LANG`, default `ja`). Issue and PR titles stay English.
- **A mid-workflow stop always sends a `confirmation` Telegram first**, so the user is alerted
  off-screen. The rule and its exact command stay resident in `CLAUDE.md` under
  "Mid-workflow stop notification". `halfrun.md` carries the one form specific to a command: the
  resume-command body of its stop before commit.

## 2z. `needs-human-review` — the child that stops before its commit

An issue carrying **`needs-human-review`** is degraded to a `halfrun`-shaped stop, whichever entry
point reached it — `fullrun` or `backlogrun`. It is `auto-ok`'s opposite: that label widens
unattended execution past an epic's edge, this one withholds its last step, and both may be applied
**only by a person**. It exists because some work's quality is not something a test can judge — a
**published artifact** whose unit tests say nothing about the writing, or **a choice that was a
person's to make** such as picking one of several generated candidates.

- **Implementation and the verification gate run normally** — refactor, `pnpm josh gate`,
  `/code-review`, exactly as for any other child.
- **Run `pnpm josh test:e2e` yourself before stopping.** With no pull request there is no CI E2E job,
  and `pnpm josh followup` is never reached. This is `halfrun`'s situation exactly: you run it and read
  what it prints. A printed skip is the answer for a project with no E2E suite; a skip nobody saw
  printed is not.
- **Nothing is committed, pushed, opened as a pull request or merged.** `pnpm josh bump`,
  `pnpm josh git` and `pnpm josh followup` are never reached.
- **The working tree is left uncommitted, and nothing is stashed.**
- **Send a `confirmation` Telegram and stop the whole run.** The remaining children are not started —
  inside a `backlogrun` this is the one thing that is *not* park-and-continue.
- The Telegram body carries the **resume command**, in the same form `halfrun`'s own stop uses.
- **Resuming is `halfrun`'s stop exactly**: a person looks at the working tree and, if it is right,
  carries on from the commit themselves. The stop report carries that resume command too, not only the
  Telegram.

**Stopping is the specification, not a failure.** The label's job is to stop a batch walking past a
decision that was a person's to make.

**Read the answer from `pnpm josh issue:state <N>`, never by matching the label string yourself.** It
prints a `human_review: yes` / `human_review: no` line beside the state and the labels, through the
same case-insensitive comparison every other workflow label goes through — so `Needs-Human-Review` is
not missed. **Ask once, before implementing**: `epic:next` prints a bare issue number and `fullrun`
and a batch child are handed one, so the check is one call of its own, made the moment the number is in
hand and before the plan.

```bash
pnpm josh issue:state <N>                      # state, labels, and human_review
pnpm josh issue:state <N> --repo <owner/repo>  # a child in another repository
```

**Never apply or remove it**, exactly as strongly as `auto-ok`: a mark a run can clear for itself is
not a mark. Everything but typing the command on an explicit instruction in the current turn is a
proposal, written as an Issue comment and left for the person. The label itself is created once per
repository, by a person:

```bash
gh api repos/{owner}/{repo}/labels -f name=needs-human-review -f color=d93f0b -f description="Implement and verify, but stop before committing so a person can look"
```

**It is not `needs-decision`, and reading it as one breaks two things.** `needs-decision` withholds a
run's *start*; this withholds its *end*. So a `needs-human-review` issue is still offered — excluded,
the artifact a person is meant to look at would never be produced — and a child stopped by it **goes on
holding its repository**, because the uncommitted work is still in the checkout; read as parked there,
the next child would start `git switch main && git pull` on top of it. The code encodes both halves by
leaving the label out of two sets: `scripts/git/issue-labels.ts` keeps it out of
`NOT_DIRECTLY_RUNNABLE_LABELS` and `scripts/epic/epic-busy.ts` keeps it out of the parked set.

Each entry point's own branch stays in its own file — `fullrun.md`, `halfrun.md`,
`backlogrun.md`, `backlogrun.md` — and routes here for the definition.

## 2a. The `into <target>` suffix — where the new Issue lands

`kickoff new` / `fullrun new` / `halfrun new` accept a suffix naming the epic the run's artifact
belongs to. Without it the artifact belongs to no epic, and `epic:next` only ever offers an epic's
children — so a forgotten instruction parks that Issue permanently rather than losing it visibly.

```
kickoff new into #909
fullrun new into #909
halfrun new into #909
kickoff new "<title>" into #909
kickoff new into joshuafolkken/kit#909
```

`into` is the spelling because the alternatives collide with forms that already mean something else:
`kickoff new #909` reads as the existing `kickoff #N`, and `kickoff new epic #909` reads as "create a
new epic" when what gets created is often a single Issue.

- **One artifact goes in: the top-level one this run created.** No split, and it is the Issue; a
  split, and it is the epic. The children belong to that epic, not to the target.
- **Insert as soon as the artifact exists** — before implementation in `fullrun new`, before the plan
  comment in `kickoff new`. Left until the end, a run that stops halfway leaves behind exactly the
  orphaned Issue this suffix exists to prevent.
- **The insertion always goes through `pnpm josh epic --add <E> <N> [--before <M> | --after <M>]`.**
  Never hand-edit the epic body: the declaration and the `blocked-by` relations then disagree,
  `epic:next` answers `error`, and an unattended run stops.
- **Decide the position, then record why** — in the target epic's body or as an Issue comment. The
  position follows whatever criteria the target epic has already been ordered by — work whose effect
  compounds over the remaining children goes earlier, and a child already in progress is never jumped
  ahead of.
- **A target that is not an epic is refused, and the refusal names both ways out**:
  `pnpm josh epic --promote <N> <N...>` when it is a request, a discussion or a container, or a new
  epic over both when it is itself one of the deliverables. Never promote on your own — which arm
  applies depends on what the target is, and promoting rewrites someone else's Issue into a container.
- **A cross-repository target is written `owner/repo#N`** and inserted from that repository's
  checkout; run there, since `epic --add` reads and writes only the repository it runs from
  (`prompts/collaboration-workflow/cross-repo-epic.md`). A bare `#N` resolves to this repository's
  issue of that number.
- **No suffix leaves the behavior exactly as it was.**

**It is not `epic:bundle`, and both still run.** `epic:bundle` *recommends* an epic for a newly filed
Issue and does nothing when the signal is weak; `into` is a person naming one explicitly. They are
separate routes, so the `epic:bundle` call that follows a filing happens exactly as before.

## 2b. Delegating a step to a cheaper tier

Designing, assessing a split and reviewing are judgement; applying a fix the gate has already named is
not. Delegation is the correction: the steps whose answer is already decided go to a cheaper execution
tier, and the judgement stays where it is.

**Ask before delegating any step of a run**, and use what it answers:

```bash
pnpm josh delegate <step>   # → delegate | keep ; the reason on stderr
pnpm josh delegate --list   # the enumeration, and what was rejected and why
```

**Never decide it yourself.** "This one is simple enough for the cheap tier" is a judgement made under
cost pressure, and cost pressure resolves it toward *cheap enough* exactly when a mistake is most
likely — the same reason `pnpm josh review:brief --level-only` takes the review level off an agent's hands.

**Anything not on the list is `keep`.** A step nobody classified must not be delegated because nobody
said it could not be — the default is the rule, not a fallback. A missed entry costs money, and a
wrong `delegate` costs correctness, quietly.

**A step earns its place by naming how a wrong result is caught** — by something that runs in the
parent tier and costs less than redoing the step. "Unlikely to be wrong" is not that. Three
conditions: (1) the step can be verified without being redone, (2) a wrong result is *caught* by that
verification, and (3) the row exists on the enumeration — meeting the first two is not membership
until someone adds it.

**A candidate is rejected on one of two arms, and both are recorded.** One arm **names no verifier**
at all: a notification body, a decision-log comment and a status read each ship their mistakes with
nothing left to disagree with them. The other arm has a verifier and is kept anyway, because **a wrong
result propagates too far** to be worth catching after the fact — a wrong root cause produces a fix
that passes the gate, a wrong design is paid for by every step after it, a missed split widens one
Issue into a batch nobody authorized, and a cheaper review finds less. `--list` shows both groups as
**rejected** rather than absent, and `pnpm josh delegate <step>` answers `kept deliberately` for a
step that was weighed and `kept by default` for one nobody considered.

**The mechanism is not the unit.** How a thing is delegated — an isolated execution unit, an explicit
brief, a result the parent can verify, a failure that surfaces — is separate from what is delegated.
The units are one step of a run (`gate-fix`, `survey`) and one whole child of a batch (`epic-child`) —
an epic's child and a named issue of a `backlogrun` alike. **They share one
mechanism** — one enumeration, one command, one verifier requirement; building a second is the clone
`CLAUDE.md` prohibits, so **no second row like `backlogrun-child` is added**. **A batch entry point
that does not delegate is the defect**: the per-issue procedure is `backlogrun-child.md` → "Each child runs in a
delegated unit", which `backlogrun.md` → "Named issues run first, in order" applies to a named issue.

**`followup-filing` is a third unit — one whole sub-procedure of a run.** The late-run follow-up
filing chain — `issue:scout` → file the Issue → `epic:bundle` → `epic --add` — is expensive because of
the large context it runs in at a run's tail, not the step count. A fresh unit runs the same chain at a
small context, handed the finding text the review round cap already composed. Its verifier is
`epic-child`'s exactly — the parent reads the filed Issue from GitHub with `pnpm josh issue:state
<new>`, not the unit's summary, so a follow-up reported filed but not created is still absent. The
point of use is that branch-2 filing, and `batch:guard`'s one-call-per-step verdict is untouched.

**`epic-child`'s verifier is not the child's own completion report.** The parent reads the child's
state from GitHub — `pnpm josh issue:state <N>`, the moment the unit returns — because a child reported
done whose pull request never merged is still open.

**Reading that state is not the same as reading `CLOSED` and calling every other answer a failure.**
That is why the command prints a `human_review:` line beside the state: **one open answer is the run's
own ending rather than an unfinished child**. A child stopped by `needs-human-review` comes back open
**by design** (§2z) — its `in-progress` stays on, and it is never counted against the
consecutive-failure guard. Read as a failure there, the parent strips that label, releases the
repository, and hands the next child a `git switch main && git pull` on top of that uncommitted work.
The classification belongs to the per-entry procedure: `backlogrun-child.md` → "Each child runs in a delegated
unit", which `backlogrun.md` → "Named issues run first, in order" applies to a named issue. The
enumeration itself is `scripts/delegation/delegation-policy.ts`, printed in readable form by
`docs/josh-commands.md` → "`josh delegate`".

### The pre-implementation reading — what goes to a unit, and from which file

**The investigation in front of an implementation is reading, and reading is what a delegated unit is
for.** **The line is what the file is for, not how large it is.** Reading to understand the Issue's
subject goes to the unit; reading a file this run is about to edit stays in the main line, because the
main line cannot issue an `Edit` against text it does not hold.

**What comes back is the conclusion plus the `file:line` citations that support it — never the file
text.** A throwaway probe script is written, run and deleted inside the unit, which returns its output
alone.

**The threshold is 3 files, and it is a count, not a forecast: the read that takes the count of files
the run will not edit up to it is where the reading goes to a unit of its own.** The ones below it stay
in the main line, and **the unit is not sent back over them** — the brief carries what the main line
already concluded, and the unit reads on from where the count tripped. **Counting is what removes the
judgement**: the reads are counted as they are made, so a small investigation never trips it.
`pnpm josh delegate --list` prints the count.

**A delegation resets the counter rather than spending it, and `pnpm josh investigation:guard` is what
counts.** The counting happens in a `PreToolUse` hook that reads the transcript, and the read that
reaches the threshold is **refused** rather than commented on. A delegation clears the pending set,
three more unedited files rebuild it, and the refusal fires again; **one refusal per accumulation**
keeps a false positive costing a single round trip. A refusal re-arms on another accumulation as well
as on a delegation, so a run that ignored its one refusal is spoken to again. **The guard refuses
nothing inside a delegated unit** (a read-only unit has no `Agent` tool to dispatch with), and a file
this run **edits is never counted, before the edit or after it**. `docs/josh-commands.md` →
"`josh investigation:guard`" carries which shell commands count as reading and the
`JOSH_INVESTIGATION_GUARD` off-switch.

**The main line does not idle while the unit reads.** A delegated unit is a command that takes
minutes, and §2h already says what runs beside one: the work that writes nothing the unit's result
depends on. Here that work is named rather than judged — **read the files this run is about to edit**,
which stay in the main line by definition and are needed before the first `Edit` either way. Start the
unit, read those, then read what it returned.

**And when the investigation needs more than one unit, they go out in a single fan-out turn — not one
after another.** This is the turn-batching principle (§2h) reaching the `Agent` launches the
round-trip batcher never sees. **The condition is independence, and it is read from the questions
rather than assumed**: before dispatching, ask of each brief whether it could have been written at the
*start* of the investigation — the ones that could go out together, and only a brief that genuinely
cannot be written until an earlier unit has answered waits for that answer. Enforcement is not
implemented (the launches are minutes apart and independence between two free-text briefs exposes no
mechanical target), so the rule is carried in prose and the run-timing measurement shows whether it held.

**Where the Issue already names the location, the reading is not delegated at all.** A body or a
comment that names the file, the function or the rule has done the unit's job, and the reading that
follows it is reading of a file the run is about to edit. The threshold and the verification path are
unchanged: what comes back from a unit is still the conclusion plus its `file:line` citations, and the
parent still opens those lines.

**It is not `survey`, and it is not `diagnosis`.** `survey` reports *where* something appears and is
checked by one `grep`; this reports *how the subject works* and is checked by opening the lines it
cited. `diagnosis` stays **kept**: the unit reports what the code does, and what that means and what to
change is the main line's.

## 2c. The `owner/repo#` prefix — which repository the run acts on

Every entry point takes the target repository in front of the Issue reference. Without it the target
is the repository the session runs in.

```
kickoff joshuafolkken/kit#412
kickoff kit#new
kickoff kit#new "<title>"
fullrun joshuafolkken/app-kit#12
halfrun kit#412
backlogrun kit#1 kit#2
backlogrun joshuafolkken/kit#858 --only
```

- **One definition, every entry point.** The prefix goes where `#N` goes, so no new keyword is added,
  and `owner/repo#new` stands in the same slot as `owner/repo#N`.
- **A short name expands by prefixing the session repository's owner** — `gh api repos/{owner}/{repo}
  --jq .owner.login` — and **never by searching kit#869's map**, which answers where a checkout is
  rather than which repository is meant. A short name therefore satisfies the first-party test (owner
  equality) by construction, so **there is structurally no path by which a short name resolves to a
  third-party target**, and a repository that is not checked out here is still a valid `kickoff`
  target. A name that does not exist fails as `gh` not found: report it, never read it as a near-miss
  for another name.
- **It is not the standing prohibition on a bare `#N`.** What that forbids is a bare *Issue number*,
  which resolves without complaint to a different issue of the same number; a bare *repository* name
  whose owner is determined has no such failure mode.
- **An explicit owner that is not the session's is a third-party target, and it stops the run.**
  `fullrun <other-owner>/repo#12` names a tracker we do not own, and every write there is Tier C
  (`CLAUDE.md` → "Third-party repositories are Tier C"). **Decide it mechanically**: whether the owner
  equals what `gh api repos/{owner}/{repo} --jq .owner.login` returns. Typing the prefix is not the
  explicit instruction that rule requires. **Send a `confirmation` Telegram and stop** — nothing has
  been produced yet, so there is no finding to record and no draft to prepare.
- **No prefix leaves the behavior exactly as it was** — the target is the session's repository.
- **`kickoff` needs no checkout**: name the target repository in the path of every `gh api` call and
  never clone. The one exception is the split path's epic, since `pnpm josh epic` only writes the
  repository it runs in — run it in that repository's checkout, or fall back to `gh api
  repos/<owner/repo>/labels …` followed by `gh api repos/<owner/repo>/issues -f title="<epic-title>" -f
  'labels[]=epic' -f body="<body>"`, and report that `epic:check` could not be run. The promote arm has
  no such fallback: with no checkout there, file the children and stop.
- **The implementing entries require a checkout and never create one — when the target is another
  repository.** A prefix naming the session's own repository changes nothing (`fullrun kit#412` in the
  kit checkout behaves exactly as `fullrun #412`). Otherwise resolve the checkout from `pnpm josh
  doctor`'s map; **no checkout there, or a tree that is not clean, stops the run** with a
  `confirmation` Telegram — cloning decides the layout of someone's machine for them, and a dirty tree
  holds work that is not yours to stash. Otherwise the commands that act on the target execute in that
  checkout.
- **A named epic is exempt from the whole bullet above**: `owner/repo#E` names where the *epic* lives,
  not where its children are implemented. Its state is read against that repository through `gh api`,
  so that repository needs no checkout. The checkout rules bind each child at implementation time,
  against **that child's** repository ("Concurrency" in `backlogrun.md`).
- **Independent of `into <target>`**: this says which repository the run acts on, `into` says which
  epic the artifact joins — `kickoff kit#new into joshuafolkken/kit#909` is one correct line.

## 2d. A prerequisite discovered mid-run — a dependency, not a park

**A prerequisite discovered mid-run is a dependency, not a park.** Finding that something else in
*this* repository has to land first is a third situation, distinct from an upstream defect and from a
split: the Issue in hand is still one deliverable, it just needs another one before it.

**Four kinds of other work turn up mid-run, and the procedure differs for each.** Reading one as
another is the failure this section exists to prevent:

| What turned up                                                              | What to do                                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A defect originating in **another package**                                 | File the upstream Issue and **stop** — Tier A for a first-party target; a third-party one is Tier C, recorded and drafted rather than filed (`CLAUDE.md` → "Cross-package problems"; `prompts/collaboration-workflow/upstream-interrupt.md`) |
| This Issue was really **several** (a split)                                 | File the children and the epic and **stop** — except under `backlogrun`, whose authorization already covers a batch, so the children are filed and run through (`split-assessment.md`) |
| Another Issue in **this** repository has to land first (**a prerequisite**) | This section                                                                                                            |
| Something worth filing that is **none of the three** (**an observation**)   | File it **without asking** — Tier A for a first-party target — and **carry the run straight on**: nothing is stashed, nothing is parked (§2i). **A delegated child does not file here**, and a filing at depth 1 or deeper cites the depth-0 work it blocked; one that cannot cite it goes to `docs/observations.md` and is filed on its second sighting — all of them §2i's |

**File the prerequisite with the `route:tier-a` label**, so a Tier A filing made during implementation
stays countable by filing route afterwards. **This paragraph belongs to the prerequisite row, not to
the table** — the label means a filing the run is *blocked by*, so the observation row carries no
`route:` label of its own (§2i):

```bash
gh api repos/{owner}/{repo}/issues -f title="<title>" -f 'labels[]=route:tier-a' -f 'labels[]=depth:<n>' -f body="<body>"
```

Every "file the prerequisite" below means that labelled filing, and it always happens **first**: the
steps after it name a number that does not exist until it is. **`pnpm josh issue:scout "<title>"` goes
in front of that call, exactly as it does for a `new` entry** (§2e): a filing made mid-run is the one
most likely to duplicate something.

**Each entry point's own branch stays in that entry's file:**

- **A named epic under `backlogrun`** files without confirmation, records the dependency with
  `pnpm josh epic --add <E> <N> --before <M>` — `<E>` the epic, `<N>` the prerequisite just filed,
  `<M>` the child in hand — and the run **continues rather than parking it** (`backlogrun-park.md` → "A
  prerequisite discovered mid-run"). Parking is only for a prerequisite that *cannot* be expressed as
  a dependency — one needing a design decision nobody has made, a Tier B toss-up, or a Tier C action.
- **`fullrun` / `halfrun`** file the same way without asking, insert the prerequisite into the epic
  that already tracks the Issue or create one over both, and then **stop**, leaving the person one
  command to type (`fullrun.md` / `halfrun.md`). Typing `fullrun` approved implementing **one** Issue;
  a batch is a different authorization, so the stop stays.

**Two steps every entry's procedure turns on**, both load-bearing rather than tidy-up:

- **`git stash push -u` — the `-u` is not optional.** The work in progress almost always includes a
  new `*.test.ts`, which is untracked, and a stash without `-u` leaves exactly those files in the tree
  for the next child's `git switch main && git pull` to refuse.
- **The Issue comment is what gets the stash popped, not the Telegram.** The run that later picks the
  paused Issue up reads that comment and pops before implementing. Say it in the Telegram too — the
  comment is the record.

**Automatic filing is capped at 10 Issues per run** at every entry point. On reaching it, stop and
report. `kickoff` is exempt — it never implements, so it never discovers one.

## 2e. Before filing a new Issue — `pnpm josh issue:scout`

**Every filing asks two questions before it happens, and one command answers both.** Run it the moment
the title exists and **before** the `gh api … issues` call that creates the Issue:

```bash
pnpm josh issue:scout "<title>"                                   # alias: josh isc
pnpm josh issue:scout "<title>" --body "<one-line summary, citing #N where the work follows one>"
```

- **`Duplicates:` is read, not skimmed.** Open each candidate. When an **open** one covers the same
  work, **do not file**: send a `confirmation` Telegram and stop with the command to run against the
  existing Issue — "Please run `fullrun #<existing>` to execute this Issue." When none covers it, say
  so in one line and carry on filing.
- **A candidate marked `(closed)` is a different answer.** The scan covers what closed recently as
  well as what is open, because the work most likely to be filed twice is the work that just finished.
  A closed candidate that covers the same work means **the work is already done** — so there is nothing
  to run. Verify it against the merged code, then take the exit in §2g → "When the work turns out to be
  already merged". A closed candidate that does *not* cover the work is noted in one line and the
  filing carries on.
- **`none` is an answer.** The command reports no candidate rather than the closest miss.
- **`Epic:` front-loads the placement.** Its recommendation is `epic:bundle`'s, which makes
  `add_to_epic` / `create_epic` Tier A and `ask` a stop, in exactly the reading §2a's `into <target>`
  suffix would have given by hand. Where the user typed `into <target>`, that naming wins.
- **`Epic: not asked` is not `Epic: none`.** The epic half decides from the issue numbers the summary
  names, so a title-only call gives it nothing. **Pass `--body` whenever the work follows an existing
  Issue** — one line citing `#N` is enough, and naming the epic itself (`part of epic #<E>`) is
  answered with that epic.
- **It does not replace `epic:bundle`, which still runs after the filing.** This one answers about an
  Issue that does not exist yet, from a title; that one answers about an Issue that does. Both calls
  happen — the scout before the `issues` call, `epic:bundle` after it.
- **Every filing route runs it, not only a `new` entry point.** The trigger is the `gh api … issues`
  call, never which keyword started the run — §2d's prerequisite, §2i's observation and the review
  round cap's branch-2 filing all go through it.
- **A `#N` entry point does not run it *for the Issue it was handed*.** `fullrun #N` / `halfrun #N` /
  `kickoff #N` are given an Issue that already exists. That says nothing about an Issue such a run goes
  on to file later, which the bullet above covers.
- **The split path files each child through the same step.** The epic itself is not scouted: it is
  created over children that were, and `epic:bundle` places it afterwards.

Full behavior, the thresholds and why the duplicate half compares titles rather than bodies:
`docs/josh-commands.md` → "`josh issue:scout`".

## 2f. The working-tree hold — one run per tree

**Ask `pnpm josh run:hold` before anything else, and obey what it answers.** It is the first call of
`fullrun` and `halfrun` alike — before the title is normalized, before `git switch main`, and **before
a `new` entry files its Issue**, because a run stopped after the filing has already left behind the
artifact it should not have created.

```bash
pnpm josh run:hold <N>        # a `#N` entry point ; alias: josh rh
pnpm josh run:hold            # a `new` entry point, before the issue exists
pnpm josh run:release <N>     # that same run releasing its own record ; alias: josh rr
pnpm josh run:release         # the bare form releases the unnumbered run's own record
pnpm josh run:release --force # a record left behind by a run that has ended
```

- **`hold` — this run now holds the tree. Continue.**
- **`busy` — another run holds it. Stop.** Send a `confirmation` Telegram carrying what the command
  printed on stderr (the holder, when the record was written, and the release command) and stop.
  **File nothing, create no branch, edit nothing.**
- **`unknown` — nothing was established. Stop the same way.** It is not "the tree is free".

**The unit is the working tree, and `epic-busy.ts` is not reused for it.** That read answers about a
*repository* and implements `backlogrun`'s one-child-per-repository rule; what these entry points contend
for is one branch, one index and one uncommitted diff, and a linked work tree has its own three.
**`backlogrun`'s own guard is unchanged** — the two layers guard different resources.

**`kickoff` does not claim it, and that is an exemption rather than an omission.** `kickoff` touches
none of branch, index or uncommitted diff: it reads the Issue, normalizes the title, posts the plan,
notifies and stops, every one of those against GitHub. It is a fact about the command rather than a
judgement made at the entry, and it changes nothing for `fullrun` or `halfrun`.

**Claim it in the checkout the run will edit.** The record is keyed to the work tree the command runs
in, so a cross-repository `fullrun owner/repo#N` resolves that repository's checkout from `pnpm josh
doctor` **first** — that resolution is a read and writes nothing — and claims there.

**A release names the run it belongs to.** `pnpm josh run:release <N>` removes the record only where the
record names `<N>`, the bare form only the unnumbered run's, and a record belonging to anything else
answers **`held`** and is left standing. **`pnpm josh run:release --force` is the one spelling that
removes a record this run did not write**, and the `busy` stop message names it rather than the
ordinary one.

**Release what the claim recorded, which is not always the Issue number.** A `#N` entry claimed `<N>`
and releases `<N>`; a **`new` entry claimed before its Issue existed**, so it releases with the
**bare** form however many numbers the run has acquired since — so a `fullrun new` that stops on a
split types `pnpm josh run:release`, not `pnpm josh run:release <N>`.

**Releasing is the run's, not a person's memory.** `pnpm josh followup` releases the hold on a merged
run, and a record abandoned by a crashed session expires after 8 hours. **A stop that leaves the tree
clean releases it explicitly**: a `fullrun` / `halfrun` that stops on a split, a prerequisite or a
third-party target ends with `pnpm josh run:release <N>` (bare where that run entered as `new`).
**`halfrun`'s stop before commit keeps the hold**, and so does a `needs-human-review` stop: the
uncommitted work still in the tree is exactly what a second run would trample, so the release command
goes in the stop report and the Telegram for the person to type. **An expired record over a tree that
still has uncommitted changes does not free it**: the command answers `busy` and says to commit, stash,
or release once the work is done; only an expired record over a clean tree is replaced.

**The batch entry points claim per child, not per batch.** `backlogrun` never
call it themselves; each child runs the `fullrun` procedure, so it claims on entry and `pnpm josh
followup` releases it at that child's merge. The command's behavior and the answer table are
`docs/josh-commands.md` → "`josh run:hold` / `josh run:release`"; this section is the single source of
the procedure.

## 2g. An Issue's comments are part of the Issue

**Every `#N` entry point reads the Issue's comments before it implements** — `fullrun`, `halfrun` and
`kickoff`. A `backlogrun` named issue and a `backlogrun` epic child inherit it rather than restate it: each runs in a
delegated unit executing `fullrun`'s procedure, and the hook keys its once-per-run record on the
*fork's* transcript, so every child is delivered to in its own right. The read is one call, made in the
same turn as whatever else the run already needs:

```bash
pnpm josh issue:read <N> [<N> ...]     # body and comments, one call per batch; alias: josh ird
gh api repos/{owner}/{repo}/issues/<N>/comments --jq '.[] | {user: .user.login, created_at, body}'
```

**The first line is the one to type**; `pnpm josh issue:read` answers the body and the comments for
every number named, in one call, and **says when a comment listing could not be read rather than
showing no comments** — which matters here, because the rule below is that the later text wins and a
comment nobody read cannot win anything. The `gh api` form stays for a **cross-repository** read: the
command takes no `--repo`.

`gh issue view <N> --comments` is GraphQL-backed, a cloud session is answered `403`, and
`scripts/gh/gh-document-guard.test.ts` refuses it in a runnable block. The REST call above is the portable
form.

**This repository writes its agreements into comments and then reads only bodies.** A Tier A decision
is logged as an Issue comment; the review round cap records a dropped finding's disposition; the
backlog's decision pass writes each decision to a comment on the child; a stash left behind is recorded on the Issue. **The
place a run is told to write is the place it was never told to read**, and nothing in a body says it
has been superseded, so the mistake is silent.

**What the reading is for**, so it is not skimmed: the boundary of the scope — work a comment moved to
another Issue, or added to this one; the record of an auto-decision already made; a split or epic
agreement reached after filing; a recorded stash or an in-flight branch; and a **correction of the
body's own diagnosis**.

### When a comment contradicts the body

**The later text is the agreement in force.** A body is written first and is not rewritten when a
decision arrives, so of a body and a comment that disagree the comment is the newer of the two and
wins. **This is settled by ordering, never by judging which reads better.** Name in the two-layer work
summary which comment superseded what.

**Two answers are not the run's to make, and each is decided from what the comment says:**

- **A comment that reassigns part of the scope to another Issue** takes that part out of scope: do not
  implement it, whatever acceptance criteria the body still lists, and name the Issue it went to in the
  completion report.
- **A comment saying the Issue no longer has a reason to exist** — the defect does not reproduce, or it
  was fixed elsewhere — takes the exit in the next subsection, "When the work turns out to be already
  merged". Closing an Issue is Tier C.

Everything else is the ordinary work of the run, **a widened scope included**: a widening large enough
to be several separately-mergeable deliverables is the split assessment's business
(`split-assessment.md`), not a second kind of stop.

### When the work turns out to be already merged

**A run can learn its Issue is already done in two ways, and both end here.** A **comment** says so —
the bullet above — or the **run itself verifies it**, by reading the merged code and finding every
acceptance criterion already satisfied. What is left to do afterwards is identical, so there is one
procedure and not two. **Parking it is not the place**: `needs-decision` means "waiting for an answer
nobody has given", and here the answer exists.

**The exit is the `already-done` label.** It is `needs-decision`'s counterpart: `epic:next`,
`backlog:next` and `auto-ok:next` all stop offering the Issue (`scripts/git/issue-labels.ts` →
`NOT_DIRECTLY_RUNNABLE_LABELS`, `epic-classify.ts` → `human`), and `epic:busy` stops counting it as
holding a lane. **Only a person removes it, by closing the Issue.**

```bash
gh api repos/{owner}/{repo}/labels -f name=already-done -f color=6f42c1 -f description="Verified already merged — a person closes it" --silent 2>/dev/null || true
gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=already-done'
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true
```

The procedure, in order:

1. **Record the evidence as an Issue comment, before the label.** Name the pull request or commit that
   merged the work and, for each acceptance criterion the Issue states, the file and lines that satisfy
   it. **A claim with no citations is not the finding this exit is for.**
2. **Apply `already-done` and remove `in-progress`** — the two commands above. Leaving `in-progress`
   on holds a lane against an Issue nothing will ever run.
3. **Commit nothing, push nothing, open no pull request.** The tree is clean, so release the hold with
   `pnpm josh run:release <N>`.
4. **Then behave as the entry point does for a parked child.** A `fullrun` / `halfrun` a person typed
   sends a `confirmation` Telegram naming the Issue and the merge that already covers it, and stops. An
   `backlogrun` child is park-and-continue (`backlogrun-park.md` → "park and continue").
5. **Never close the Issue.** That is Tier C at every entry point, and the label leaves the close one
   click away for the person who owns it.

**Nothing about this is a license to skip the work when it merely looks familiar.** The bar is step 1's
citations: a criterion you cannot point at merged code for is a criterion this run still owes.

### A long thread

**The fetch is one call however long the thread is; what costs is carrying it afterwards** — which is
why the call above projects each comment down to its author, its timestamp and its body. Once the
thread runs longer than the Issue itself it is exactly the pre-implementation reading §2b describes:
brief a delegated unit to return **the agreements in force plus the comment URLs that carry them**,
never the comment text.

**`pnpm josh rule:guard` refuses the body-only read** and hands over the reissue and the conflict rule
at the moment they bind (`prompts/collaboration-workflow/rule-delivery.md`,
`scripts/rules/delivered-rules.test.ts`). The refusal reaches Claude Code alone and fires once per run,
so **this section is the rule and the hook is what makes it hard to walk past** — a session that runs
no hooks still owes the read.

## 2h. A command that can take minutes is issued in the background

**The rule and its whole procedure are `background-commands.md`, read at its point of use — before
backgrounding the first long-running command (`pnpm josh gate`), and again wherever a run backgrounds
one afterwards.** It governs issuing `pnpm josh git -y`, `pnpm josh gate` and the CI wait detached
while `pnpm josh followup` stays in the foreground, the guarantee that the turn never ends at the push
— bar a dispatched lane child's pre-gate cut (`pre-gate-cut.md`), the one sanctioned turn-end before it
— and the tail that is emptied before `followup` rather than worked through after it. `background-commands.md`
is the single source; `followup.md`, `chain-rule.md` and `backlogrun-progress.md` → "Progress while the run is
quiet" route to it, and the run-tail guard (`prompts/collaboration-workflow/rule-delivery.md`) refuses
a foreground push and names it.

**A parent waiting on its children is this same rule at the batch's scale.** A background command's
completion is what re-invokes the session, so a parent with children in flight already has a wake
delivered to it and never has to time one — which is why the `backlogrun` loop starts no
sleep of its own and reads its polling figures as floors on a re-ask rather than as a clock to keep
(`backlogrun-progress.md` → "The parent keeps no clock of its own", the single source).

## 2i. An observation worth filing is filed without asking

**A run that judges something worth filing files it, and does not ask.** The three routes in §2d all
cover work that changes what the run does — an upstream defect stops it, a split replaces it, a
prerequisite goes in front of it. **A plain observation changes none of that**: the Issue in hand is
untouched, and what the run holds is a finding it would be a loss to forget. Handing it over is wrong
twice: filing into a first-party repository is **Tier A** and already settled, and stopping for an
answer under `backlogrun` parks the run without saying so.

- **File it, without asking, the moment you judge it worth filing.** A **first-party** target — its
  owner equal to this session's repository owner, decided by `gh api repos/{owner}/{repo} --jq
  .owner.login` rather than by judgement — is Tier A. **A third-party target is Tier C and is never
  filed** (`CLAUDE.md` → "Third-party repositories are Tier C").
- **It carries no `route:` label of its own.** `route:tier-a` means a filing the run is *blocked by*,
  and an observation blocks nothing. Where one of the interrupt tests is met the filing takes
  `route:interrupt`; otherwise it takes neither.
- **Both ceilings apply to this route.** §2d's **10 Issues per run** counts this filing too, and so
  does the backlog **WIP cap** — an observation that does not block the run is *discretionary*, so with
  more than 30 open Issues in the target repository, close one first, and nothing honestly closable
  means do not file (`prompts/collaboration-workflow/wip-cap.md`).
- **Run `pnpm josh issue:scout "<title>"` before the `gh api … issues` call**, as before any other
  filing (§2e).
- **Run `pnpm josh epic:bundle <new>` on what was filed**, as after any other filing. An Issue no epic
  tracks is one `epic:next` never offers. **Where that epic's root carries `auto-ok` the filing joins
  the backlog's pool** (`backlogrun.md` → "What one invocation approves").
- **The run continues.** Nothing is stashed, nothing is parked, no Telegram is sent, and the Issue in
  hand is implemented as it was. Name what was filed in the completion report.

**What stays a judgement is whether it is worth filing, not whether to ask.** An observation nobody
would act on is not filed at all — dropping it costs nothing, and the WIP cap makes dropping the
default at the margin.

**The procedure is `observation-filing.md`, and it is read the moment you judge something worth filing
— in full, in the same turn, before the `gh api … issues` call.** It carries the depth test and its
table, the depth labels and their provisioning commands, the depth-0 share, the ledger's five-field
grammar and its commit path, the promotion on a second sighting, and what a delegated child does
instead. The four things above are the rule; that file is how each one is carried out, and it is the
single source of every one of them.

## 3. What stays resident, and what is read from here

**The first question is whether the rule's trigger can be named:**

> **Can the moment the rule begins to bind be named as one tool call?**

**A rule whose trigger can be named moves its body out of `CLAUDE.md`.** It goes on the enumeration in
`prompts/collaboration-workflow/rule-delivery.md`, and a hook refuses that call and states the rule —
cheaper than resident prose, because it costs nothing on every other turn, and **stronger, because a
refusal cannot be skimmed past**. **Relocating is not deleting** — the rule's text survives, on a
stronger channel.

**What stays behind is the trigger and the criterion, one line, because the channel reaches one
harness.** `CLAUDE.md` is agent-agnostic by construction — `AGENTS.md`, `GEMINI.md` and `.cursorrules`
are pointers to it, and a Codex, Gemini or Cursor session runs no `.claude/settings.json` hook at all;
so does a Claude Code session with the guard's own off-switch set. **The gain is the body, not the
line.** A rule may leave residency entirely only where the agent that has to obey it is always this
harness.

Only a rule whose trigger cannot be named reaches the second question:

**A rule stays in `CLAUDE.md` if and only if it has to fire on a turn where no skill was loaded.** That
test has exactly one input: when does the rule first bind — before a command has started, or after.
Everything a run reaches only *after* it has read this skill is routed to from `CLAUDE.md`, never
restated there.

`CLAUDE.md` is the only document this section is about. `AGENTS.md` and `GEMINI.md` hold no rules at
all — they are pointers to it.

**How much of a resident rule is resident is `rule-residency.md`, and it is read when a rule is
actually being placed, moved or retired.** The two questions above decide *whether*; that file decides
*how much*, and carries the trigger-plus-pointer shape a resident rule takes, the enumeration of every
resident rule that has an on-demand counterpart, the retirement route and its three tests, and the
readings of the retired `rule:value` measurement. **No run reaches it** — the moment it binds is a turn spent editing
these documents, never a turn spent executing an Issue. It is the single source of everything it
carries.
