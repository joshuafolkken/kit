---
name: workflow-commands
description: The procedures for the Issue-driven shorthand commands `kickoff`, `fullrun`, `halfrun`, `queue`, `epicrun` and `backlogrun` — planning, implementation, the verification gate, unattended epic and backlog execution, the `/code-review` → `followup` chain rule, auto-merge and the Telegram notifications. Read this the moment the user types one of those keywords (with or without `#N` / `new`), before running any command, and read it too when asked what one of them does or when a run of one has to be resumed or repaired.
---

# Issue-driven workflow commands

`kickoff`, `fullrun`, `halfrun`, `queue`, `epicrun` and `backlogrun` are the shorthand commands this
package's collaboration workflow is built on. Their procedures live here rather than in `CLAUDE.md` because
each one applies only while its own command is running — keeping them resident spent context on
every turn to describe a workflow most turns never enter.

The canonical extended reference is `prompts/collaboration-workflow/` (indexed by `prompts/collaboration-workflow.md`); this skill is the
operational procedure, and the two must agree.

## 0. The rule that fires before any of them — explicit invocation

**Never start a `kickoff` / `halfrun` / `fullrun` / `queue` / `epicrun` / `backlogrun` workflow (including their
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

**A session cut inside a declared budget is not a new invocation** (joshuafolkken/kit#1714). A
`backlogrun` that is cut and resumed is still the one invocation a person typed — the keyword
authorized the declared budget, and the cut is an execution detail of spending it, exactly as opening
a lane or delegating a child is. What this rule forbids is _inferring_ a workflow from a request's
shape; it has never required the keystroke to land in every session's own transcript, which is the
reading `epicrun.md` → "Each child runs in a delegated unit" already applies to a delegated child.
The last bullet above is untouched, because it is about an _earlier turn's_ authorization: a run with
no budget left, or none begun, has nothing to carry. **The reading covers `backlogrun` and `queue`,
and those two only** (joshuafolkken/kit#1774) — an `epicrun` or `fullrun` cut still waits for the
keyword.

**`queue` qualifies on the same ground, and on firmer.** It names the issues it will run at the
moment the keyword is typed, so what a resumed session continues is a finite list a person wrote down
— less to infer than under `backlogrun`, whose pool is a set that moves while the run is going.
`epicrun` and `fullrun` do not qualify, and for reasons of their own rather than for want of one: an
`epicrun` holds lanes in flight across the seam, and a `fullrun` ends at one issue and has nothing to
carry.

**`backlogrun.md` → "The session cut is inside the invocation" is the single source of the
mechanism** — the record, the two commands, and what each answer means. `queue.md` → "The session
boundary" carries the one thing that differs and does not restate the rest: **a queue's invocation is
pinned to the list that was typed**, and the issues it has finished live in the record's `done` field
rather than shrinking the string. Shrinking it is what `run:carry` answers `mismatch` to, and
loosening that comparison would give up joshuafolkken/kit#1722's single-writer guarantee.

## 1. Which file to read

Read this file, then the one for the command that was typed. `fullrun`, `queue`, `epicrun` and
`backlogrun` also obey `chain-rule.md`, but at a point of use rather than at the entry: it governs
the `/code-review` → `followup` chain, which runs *after* the first edit, so it is read then and not
here (see "Five documents are read at the point of use" below). `halfrun` and `kickoff` never reach
it — `halfrun` stops before the commit, and `kickoff` never implements.

| Typed keyword                            | Read                                        |
| ---------------------------------------- | ------------------------------------------- |
| `kickoff` / `kickoff #N` / `kickoff new` | `kickoff.md` + `split-assessment.md`        |
| `fullrun` / `fullrun #N` / `fullrun new` | `fullrun.md` + `split-assessment.md`        |
| `halfrun` / `halfrun #N` / `halfrun new` | `halfrun.md` + `split-assessment.md`        |
| `queue #N1 #N2 …`                        | `queue.md` + `fullrun.md`                   |
| `epicrun #E…`                            | `epicrun.md` + `split-assessment.md` + `fullrun.md` |
| `backlogrun`                             | `backlogrun.md` + `epicrun.md` + `split-assessment.md` + `fullrun.md` |

### The fetch is one `Read` call per file

**Fetch each file above with one `Read` call of its own — never `cat`, and never two of them in one
command** (joshuafolkken/kit#1797). The distributed `.claude/settings.json` caps a Bash result at
`BASH_MAX_OUTPUT_LENGTH` characters, and **every document in this set is larger than that cap**, so a
`cat` hands back a middle-truncated preview rather than the file. Measured on `fullrun #1783`, the
entry issued two such `cat` calls, got 1,725 and 2,034 characters of preview, and then read five of
the files again individually: two wasted requests, and about 3.7k tokens of dead preview resident for
the rest of the run.

**Reading the preview and carrying on is refused, and that is the point rather than a precaution.**
A truncated fetch produces a run that has read its instructions only partly and cannot tell which
part, which is the one failure this whole set exists to prevent — so the answer is a fetch that
cannot truncate, never a judgement about whether enough of it came back.

`pnpm josh read:set [<keyword>]` prints the cap, marks every file that exceeds it, and states this
instruction beneath the report, so the rule arrives with the figures rather than only here.

### Five documents are read at the point of use, not at the entry

**`followup.md`, `eval-gate.md`, `latest-gate.md`, `chain-rule.md` and `background-commands.md` are
not entry reads** (joshuafolkken/kit#1797, joshuafolkken/kit#1856, joshuafolkken/kit#1873). Each is
fetched **in full, in the same turn, by the step that has to obey it** — and that step is a named
command, so there is no judgement about when:

| Document                | Read it when                                                                   |
| ----------------------- | ------------------------------------------------------------------------------ |
| `latest-gate.md`        | `pnpm josh latest:scope` answers `required` — before `josh latest` runs         |
| `eval-gate.md`          | `pnpm josh eval:scope` answers `required` — before `pnpm josh eval` runs        |
| `followup.md`           | Before issuing `pnpm josh followup`, in that same turn                          |
| `chain-rule.md`         | Before running the `/code-review` step (`fullrun` / `queue` / `epicrun` / `backlogrun`) |
| `background-commands.md` | Before backgrounding `pnpm josh gate` — the first long-running command a run detaches (`fullrun` / `halfrun` / `queue` / `epicrun` / `backlogrun`) |

**This is "read it at the point of use", not "read it later", and the difference is what makes it
safe.** joshuafolkken/kit#1344 and joshuafolkken/kit#1460 each measured a rule demoted to "read it
later" firing exactly never; nothing here is demoted, deferred past its own call, or summarized —
the fetch is whole and it happens before the command it governs. What changes is only that a run
which never reaches the step never pays for it: measured on `fullrun #1783`, `pnpm josh eval:scope`
answered `skip` and `eval-gate.md`'s 6,420 tokens were a total loss, while `followup.md`'s 10,326
rode 55 requests before their first use. **`chain-rule.md` is that same waste seen from the entry
(joshuafolkken/kit#1856)**: its 7,396 tokens rode every request from the entry of a `fullrun` /
`queue` / `epicrun` / `backlogrun`, though the `/code-review` → `followup` chain it governs does not
bind until after the first edit — so at the moment this measurement is taken, the first edit, the
run carried it for nothing.

**A `skip` answer is the whole answer, and it reads nothing** — that arm is `latest-gate.md` and
`eval-gate.md`, whose `:scope` command can say the step is not due. `followup.md`, `chain-rule.md`
and `background-commands.md` have no such skip: their step always comes for an implementing run, so
they are read when it arrives rather than conditionally. Either way **the trigger sentence for each
of the five is resident in §2 and in the command's own file**, so a run that never opens these
documents still calls the right command at the right moment.

### A section reference is read as a section

**A pointer written `` `X.md` → "Heading" `` is read as that section, never by opening `X.md` whole**
(joshuafolkken/kit#1776):

```bash
pnpm josh doc:section <file.md> "<heading>"   # the section, verbatim ; alias: josh ds
pnpm josh read:set [<keyword>]                # what an entry reads, and what it costs ; alias: josh rs
```

**Reading the file was costing what the pointer never asked for, and it is the largest fixed cost a
run has.** The parent session of 2026-09-11 measured **159,323 billed input tokens per request at 16
requests** at exactly this point — the documents read, nothing implemented, and `pnpm josh cost`
answering `over`. `epicrun.md` alone is 2,121 lines and is opened at a `queue` entry for **four**
section references worth 699 of them. Reading those four as sections takes **37,184 tokens — about a
quarter of the whole entry read** — off what is paid before any work starts. `pnpm josh read:set`
prints both figures; the absolute ones are deliberately not quoted here, because this document is
itself in the set it measures and a sentence naming them would move them.

**Nothing is deferred and nothing is summarized, which is what separates this from the scheme that
does not work.** The section is fetched in the same turn, by the main line that has to obey it, and
printed verbatim with its subsections — what changes is the extent of the fetch, never whether it
happens. joshuafolkken/kit#1344 and joshuafolkken/kit#1460 each measured a rule moved to "read it
later" firing exactly never; this moves nothing to later, so there is no path on which a run proceeds
having only supposed it read something. **A heading that does not resolve is refused, with the file's
own headings listed** — a renamed target fails loudly rather than printing nothing and reading as a
section that had nothing in it — and **an ambiguous prefix is refused too**, rather than handing back
whichever section came first.

**The set is derived rather than transcribed.** `pnpm josh read:set` reads the table above for the
files and the documents themselves for the references, so the enumeration cannot drift from this
section; `scripts/document/entry-read-set.test.ts` pins the derivation and
`scripts/entry-read-set-document-rule.test.ts` pins this rule. **The section-reference mechanism
moved no rule and split no document to buy its 27%** — every sentence stayed where it was, and every
marker suite still pinned it there.

**joshuafolkken/kit#1797 did move text, and the same constraint held over the move.** Two bodies
left this file for a document of their own — §2i's procedure to `observation-filing.md` and §3's to
`rule-residency.md` — because neither binds until long after a command has started, and three more
documents left the table above for the command that has to obey them. **Not one sentence was deleted
or summarized, and not one assertion was dropped**: each marker suite was re-pointed at the file its
sentence now lives in, which is the same requirement §3 puts on any rule that is trimmed.
**joshuafolkken/kit#1856 moved a fourth, `chain-rule.md`**, on the same ground: it governs the
`/code-review` → `followup` chain, which does not bind until after the first edit, so it left the
table above for the point-of-use list. Nothing in `chain-rule.md` itself changed — it is read whole
at `/code-review` exactly as before — only the turn it is read on, so no sentence moved with it and
no assertion was lost. **joshuafolkken/kit#1873 moved a fifth — §2h's body to
`background-commands.md`** — this one an extraction like §2i's, not a reclassification like
`chain-rule.md`'s: §2h binds only after the first edit, at the gate, the push and the merge, so the
body left `SKILL.md` for the point-of-use list and the resident section is now a pointer plus the one
line that carries the rule at a batch's scale. Its marker suite was re-pointed at the new file rather
than dropped, the same requirement §3 puts on any trimmed rule.

**`backlogrun` reads `epicrun.md` too, and that is the point rather than an omission.** It changes
only which issues are offered and by what authorization; every procedure for *running* one of them —
lanes, park-and-continue, the `needs-human-review` stop, a prerequisite discovered mid-run, the
delegated unit, the preflight, the progress watcher, the hand-off check and the guards — stays
`epicrun.md`'s and is referenced from `backlogrun.md` rather than restated there.

## 2. What every one of them shares

- **The dependency update is asked for, not assumed.** Every implementing entry runs
  `pnpm josh latest:scope` before it implements and runs `josh latest` only on `required` — the
  trigger is elapsed time since the last update in this checkout, never a judgement, and the
  `dependency-update` skill is loaded afterwards exactly as before whenever the update actually ran.
  `latest-gate.md` is the single source, **read in full in the turn `latest:scope` answers
  `required` and not before** (§1, "Five documents are read at the point of use"); `kickoff` never
  reaches it, because it never implements.
- **The verification gate**, in this order: refactor per `prompts/refactoring.md` → **`pnpm josh gate` (lint, type check, spell check and unit tests, run concurrently) is *started* when the review starts, and *joined* before the commit** — the same treatment `josh eval` already gets below, and for the same reason: neither the gate nor the review writes to the working tree, so paying for them one after the other is pure waiting (joshuafolkken/kit#1242, measured at 187 seconds of a 1623-second run) → a subagent running `/code-review` with the brief `pnpm josh review:brief` prints
  (the level, what the gate has already proved **or is still proving** on this exact tree, and the target)
  on `git diff main`, iterating until no high/medium findings remain — **at most two reviews in total**,
  the second one a verification pass over the fixes rather than a second full read of the diff —
  run it with `pnpm josh review:brief --round 2`, which hands the fix delta over as the **target**
  rather than only saying so in prose (joshuafolkken/kit#1241): the forked review agent reads none of
  this repository's documents, so a round narrowed only in prose stays as expensive as the first
  (`prompts/review.md` → "Review round cap" and "The second round is a verification pass, not a second
  full review") → `pnpm josh eval:scope`, and `pnpm josh eval` when it
  answers `required` (`eval-gate.md`, **read in full in that same turn and not at the entry** — §1,
  "Five documents are read at the point of use"). `kickoff` is the exception —
  it never implements, so it never reaches the gate.
  **Whether that second round is due at all is `pnpm josh review:round2 --round-1-closed`'s answer,
  never a judgement** (joshuafolkken/kit#1433): `skip` on the two arms it names — round 1 wrote no fix
  code, or every path it fixed is inert — and `required` on everything else, the flag absent included.
  **Ask it once round 1's fixes are in and before the commit**: the delta it reads is then exactly
  those fixes. Nothing writes to the tree in between any more — the version bump a child used to make
  here put a `package.json` write, which is not inert, into that delta, so no arm could ever
  fire (joshuafolkken/kit#1486). **A `skip` does not carry the clean-first-round row's second half** —
  round 1 edited the tree, so the first gate's result is stale and `pnpm josh gate` re-runs before the
  commit exactly as it would have. The skip is recorded on the Issue, inside the CI wait beside the follow-up filing, so
  the condition stays auditable; `prompts/review.md` → "When round 2 is skipped entirely, and when it
  is not" is the single source.
  **Joining the gate is a step, not a formality — there is no path to a commit on a gate nobody read.**
  Read what the gate printed before `pnpm josh git -y`; a red one is fixed and re-run **whatever
  the review concluded**, and because that fix is uncommitted like every other, it lands in the
  round-2 fix delta and is reviewed with the rest.
  **Where a second round is coming, the pull request opens between the two** (joshuafolkken/kit#1261):
  once round 1's fixes are in, run `pnpm josh gate` → join → `pnpm josh git -y "<title> #<N>"`,
  and then run round 2 beside the CI that commit started. **Nothing edits the tree between that gate
  and the commit** (joshuafolkken/kit#1486) — the version bump a child used to make here is gone,
  because `pnpm josh release` decides the version from main's own history — so the gate the commit
  rests on covers the exact tree it carries and round 2's brief still reads `Already verified`.
  **A finding round 2 fixes in place is pushed before its gate**
  (joshuafolkken/kit#1326): the single check the fix reaches, then a follow-up commit on the same
  branch, then its own `pnpm josh gate` **joined before `pnpm josh followup`**
  — so the CI that commit re-runs has the gate beside it rather than in front of it. A red gate there is
  fixed, re-checked with the same single check and pushed again; the superseded cycle is cancelled by
  `ci.yml`'s concurrency group, and the merge still waits on the head commit's checks
  (`prompts/review.md` → "The round-2 fix commit is pushed before its gate"). `prompts/review.md` →
  "The pull request opens between the rounds, so CI runs beside round 2" is the single source; a clean
  round 1 has no second round and its order is unchanged.
  **A clean second round is not a turn boundary either**: the turn that reads it issues
  `pnpm josh followup`, after any branch-2 filing and `pnpm josh epic:bundle` and never in a
  turn of its own — the 19 seconds of dead air joshuafolkken/kit#1333 measured between the two
  (`prompts/review.md` → "A clean second round issues the merge in the same turn", the single source).
  While the checks are in flight the brief says so
  rather than saying nothing: `josh gate` writes a marker for as long as it runs, so the review agent
  is told not to run the unit suite the gate is running beside it — **and that sentence claims no
  result**, because a gate that has not finished has none to claim (joshuafolkken/kit#1242).
  **That gate is started once per run, not once per edit** (joshuafolkken/kit#1246): while implementing,
  re-run the **single check by name** — `pnpm josh lint:related`, `pnpm josh cspell:dot`, `pnpm josh test:related`,
  or the project's own type check — never the whole gate —
  **the unit check there is the scoped one**: `pnpm josh test:related` runs the tests the changed
  files reach and falls back to the whole suite when it cannot narrow, while `pnpm josh test:unit`
  stays what the gate runs before the commit (joshuafolkken/kit#1257) —
  ten gate runs cost 8.2 minutes of a 49.1-minute run, six of them answered by one check. Which of the
  two to run is decided by whether the review has started, never by how large the edit was — and once
  the gate is running beside the review, a later fix makes its result stale rather than sending the run
  back to a single check. The table is `prompts/review.md` → "The gate runs beside this review, not in
  front of it".
  **And a single check answers once per tree** (joshuafolkken/kit#1383): after an edit, run it again —
  there is no cap on that — but with nothing edited since it last ran on the same arguments, its
  answer is already in hand and the call buys a second copy of it. `pnpm josh time`'s `Single checks:`
  block is what says whether the run held to it; the rule is `prompts/review.md` → "A single check
  answers once per tree".
  **And the last of them runs on the last edit, in front of the gate and the review rather than after
  them** (joshuafolkken/kit#1511): `pnpm josh lint:related && pnpm josh test:related`, one call.
  `pnpm josh review:brief` refuses to compose a brief on a tree neither has been green on — and no
  brief means no attestable round — so the enforcement is the command's rather than a judgement.
  `prompts/review.md` → "The scoped checks answer on the last edit" is the single source.
  **And `origin/main` is merged into the branch before the gate** (joshuafolkken/kit#1837): `pnpm josh main:merge`, ahead of that scoped pair, so the gate verifies the tree that will merge rather than a lane cut from a stale `origin/main` — merge not rebase, and a no-op when nothing advanced. `prompts/review.md` → "origin/main is merged in before the gate" is the single source, and `epicrun.md` → "Conflicts are not predicted" is the fallback for a conflict that lands after it.
  **The rule-compliance measurement is read after the review and before `pnpm josh followup`,
  never inside `pnpm josh gate`**: the gate repeats every fix round and every child, and one `josh eval`
  is five real Claude sessions. The anchor is the merge rather than the commit because the commit now
  sits between the rounds, and `blocked` has always stopped the merge rather than the commit
  (joshuafolkken/kit#1261). **It is *started* when the review starts, because neither writes to the
  working tree**, and `pnpm josh eval:scope --since-eval` afterwards says whether the review moved a
  measured path and the run has to be repeated (joshuafolkken/kit#1152) — a stale result is never
  reported. Its last line is the verdict — `blocked` stops the merge, `unmeasured` does
  not but is reported, and a run nobody saw hold is never reported as green. `eval-gate.md` carries
  the trigger set, the cost ceiling, and why an epic's completion does not run it a second time.
  **E2E closes after that, and never by asking the user**: where the command ends in a pull request
  (`fullrun` / `queue` / `epicrun`) the CI E2E job is the result and `pnpm josh followup`
  is what enforces it; where it does not (`halfrun`), you run `pnpm josh test:e2e` yourself before
  the stop. `CLAUDE.md` → "Completion gate" carries the rule, `prompts/testing-guide.md` → "Closing
  the E2E gate without a human run" the procedure.
- **A review's verdict counts only once `pnpm josh review:attest --check` answers `ok`**, because
  `/code-review` is forked into the session's checkout rather than the run's: in a lane it can read a
  tree holding the previous child's already-merged code, find nothing wrong, and have that silence
  read as a clean round (joshuafolkken/kit#1522). `pnpm josh review:brief` names the checkout and
  prints the nonce the review attests with; `missing` and `mismatch` are both refusals, and
  `pnpm josh followup` refuses the merge on either. `prompts/review.md` → "The brief names the
  checkout, and a review that read another one is refused" is the single source.
- **An interrupt whose subject is a defect in the verification path runs alone**, and a batch resumes
  only once it has merged — decided from an enumeration (the verification gate, the code review, the
  pre-push hook, the merge checks) rather than from how serious the defect looks. It binds wherever
  children are dispatched, so `epicrun.md` → "Lanes" carries it for the parallel case and
  `prompts/collaboration-workflow/wip-cap.md` → 「実行のしかた」 is the single source
  (joshuafolkken/kit#1518).
- **A command that can take minutes is issued in the background, and the turn never ends at the
  push** — §2h. It is where a run's idle time collects: joshuafolkken/kit#1510 measured 25 idle
  minutes in a 45-minute run, 6m28s of it a foreground `pnpm josh git -y` the harness detached at its
  own cap, and 6m06s of it CI that had already gone green. `pnpm josh followup` is the one that stays
  in the foreground, because nearly every step after it reads its result — and a tail *does* follow
  the merge, measured at 3.0 min and 5.9% of a run (joshuafolkken/kit#1462), which §2h empties by
  composing the merge-independent work beforehand. Which steps those are, and the one exception, are
  §2h's.
- **A child carrying `needs-human-review` stops the run before its commit**, at every entry point —
  §2z. It is the one *child's* stop `epicrun` does not turn into a park — an `epic:audit` error and
  the consecutive-failure abort end a run too, but neither is a child asking for something.
- **`epicrun` differs on two points.** A stop that would end a `queue` parks one child instead and
  the run continues (`epicrun.md` → "park and continue"), and the keyword accepts an Issue that is
  **not** an epic — running it as a `fullrun`, and building the epic around it only if a prerequisite
  or a split turns up (`epicrun.md` → "When `#N` is not an epic"). Both follow from what the keyword
  authorizes: a batch, decided once at the start.
- **`backlogrun` takes those same two and moves the boundary.** It authorizes every issue a person
  has opted in with `auto-ok` rather than one epic's children, so what changes is which issues are
  offered — by `pnpm josh backlog:next` — and nothing about how one of them is run
  (`backlogrun.md`). It is a separate keyword rather than an argument to `epicrun` **because the two
  declare different authorizations**, and membership stays a person's to decide.
- **The working-tree hold is claimed before anything else** — `pnpm josh run:hold`, at every typed
  entry point that edits the tree, ahead of the split assessment and ahead of a `new` entry's filing.
  **`kickoff` is exempt**: it edits nothing, so it neither claims nor releases. §2f.
- **The session boundary is asked at the entry as well, not only after a merge** —
  `pnpm josh cost --over 300000`, in the same turn as `pnpm josh run:hold` and before anything else
  is started, so a session already carrying an earlier Issue's whole conversation is cut before it
  pays for one more (joshuafolkken/kit#1605 measured 88,481 tokens of carried conversation riding on
  all 49 requests of one `fullrun`, 24% of that run's cost). **It is the same one rule at a second
  application point, and not a second rule**: what the check measures, why the number is passed
  explicitly, what an exit 1 with empty standard output means, and where 300,000 comes from are all
  `epicrun.md` → "The hand-off", the single source — nothing about the post-merge application
  changes. **300,000 is a temporary experiment rather than a settled number**
  (joshuafolkken/kit#1775): the figure it replaces, where it sits in that measured distribution and
  the procedure for retreating to the previous one are all named in the same single source, so a run
  that reads the threshold here also reads that it is under test. **Only the seam and the branch
  differ.** `under`, and the run continues. `over` — or a
  run the check could not answer for — and the run **stops before the work starts**: send a
  `confirmation` Telegram carrying the figure the command printed on standard error and the resume
  command — **the invocation as it was typed, in a fresh session**, so a `#N` entry resumes as
  `fullrun #<N>` / `halfrun #<N>` and a `new` entry resumes as `fullrun new` / `halfrun new`, since
  the stop happens before the Issue is filed and there is no number to name — then run
  `pnpm josh run:release <N>`, and stop — **bare where the entry is a `new` one**, whose claim
  recorded no number ("Release what the claim recorded" in §2f). Nothing has been filed, branched, edited or pushed yet, which is
  what makes the entry the cheapest stop a run has and the reason the question is asked here rather
  than after the plan. **A fresh session is structurally `under`** — its first request carries the
  resident preamble alone, well below the 300,000 line (the measured median is in `epicrun.md` →
  "The hand-off", with the rest of the derivation) — so this never stops a run that had nothing to
  hand off. **A dispatched child does not ask it, and that is a
  prohibition rather than an omission.** `epicrun`, `queue` and `backlogrun` already own this
  question at their own seam — `epicrun.md` → "The hand-off" — where the lane hand-over, the lane reading and
  the resume command that continues the batch all live. A child that asked at its own entry would
  answer for whichever session the transcript reader picks — the parent's, in which case every child
  of a long batch stops at once, or its own, in which case a freshly dispatched unit is always
  `under` and the ask buys nothing — and either way its stop would fire a per-child Telegram, release
  a hold the batch owns and hand the person a resume command that abandons the rest of the batch. So
  **the entry ask belongs to a `fullrun` or a `halfrun` a person typed**, and nothing else. `kickoff`
  is exempt for the reason it is exempt from the dependency update: it never implements, so it never
  reaches the band this line was drawn against.
- **The split assessment** runs before any work starts, at *every* entry point, from the one
  definition in `split-assessment.md`. **The default is not to split**: separability and a scope that
  clearly exceeds what one verification gate can confirm in one pass — the guide is about 10 changed
  files and about 400 changed lines — have to hold **together**, and either alone leaves the work as
  one Issue (joshuafolkken/kit#1469). Where both hold, two or more separately-mergeable deliverables
  always means an epic — no count threshold, no ordering condition — and a `fullrun` / `halfrun` that
  finds one files the epic and **stops** rather than widening its own authorization to a batch.
- **A prerequisite discovered mid-run is a dependency rather than a park**, at every entry point —
  §2d. It is the third thing a run can discover, beside an upstream defect and a split, and the one
  whose procedure is neither of theirs.
- **An observation worth filing is filed without asking, and the run carries on** — §2i. It is the
  fourth thing a run can discover and the only one that changes nothing about the Issue in hand, so
  it is the one route whose whole procedure is "file it and keep going". **Two things narrow which
  observations reach it**, and both are §2i's: a filing at depth 1 or deeper cites the depth-0 work
  it blocked, and **a delegated child does not take this route at all** — it returns the observation
  to the parent (joshuafolkken/kit#1698). **What the narrowing turns away is recorded rather than
  dropped**, which is §2i's as well: it goes to `docs/observations.md` as one append-only line, and a
  **second** line under the same key files it (joshuafolkken/kit#1728).
- **The pre-implementation reading goes to a delegated unit once the count of subject files reaches
  the threshold §2b names** — §2b →
  "The pre-implementation reading". The line is what a file is *for*: understanding the Issue's
  subject is delegated, a file this run will edit is read in the main line, and what comes back is
  the conclusion plus its `file:line` citations rather than the text.
- **An Issue's comments are read before implementing, at every `#N` entry point** — §2g. An
  agreement recorded after the body was written lives only in a comment, and between a body and a
  comment that disagree the later text is the one in force. `pnpm josh rule:guard` refuses the
  body-only read once per run and states the reissue there.
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

## 2z. `needs-human-review` — the child that stops before its commit

An issue carrying **`needs-human-review`** is degraded to a `halfrun`-shaped stop, whichever entry
point reached it — `epicrun`, `fullrun` or `queue` (joshuafolkken/kit#1125). It is `auto-ok`'s
opposite: that label widens unattended execution past an epic's edge, this one withholds its last
step, and both may be applied **only by a person**.

**It exists because some work's quality is not something a test can judge**, and nothing in the
workflow could say so. Two kinds recur: a **published artifact** — an article is the usual one —
where the unit tests on length and required front matter pass and say nothing at all about the
writing; and **a choice that was a person's to make**, such as picking one of several generated
candidates. **None of the means already available expresses that.** Pre-applying `needs-decision` is
worse than useless: `epic:next` classifies the child as waiting on a person and never starts it, so
the artifact a person is meant to look at is never produced. Writing "run this one with `halfrun`" in
the issue body carries no force, and `epicrun #<E>` walks straight past it. Withholding `auto-ok`
does nothing whatever — an epic's children run without it.

- **Implementation and the verification gate run normally** — refactor, `pnpm josh gate`,
  `/code-review`, `pnpm josh eval:scope`, exactly as for any other child.
- **Run `pnpm josh test:e2e` yourself before stopping.** With no pull request there is no CI E2E job,
  and `pnpm josh followup` — the thing that blocks a merge on it — is never reached. This is
  `halfrun`'s situation exactly, and `CLAUDE.md` → "Completion gate" gives it the same answer: where
  no pull request is open, you run it and read what it prints. A printed skip is the answer for a
  project with no E2E suite; a skip nobody saw printed is not.
- **Nothing is committed, pushed, opened as a pull request or merged.** `pnpm josh bump`,
  `pnpm josh git` and `pnpm josh followup` are never reached.
- **The working tree is left uncommitted, and nothing is stashed.**
- **Send a `confirmation` Telegram and stop the whole run.** The remaining children are not started —
  inside an `epicrun` this is the one thing that is *not* park-and-continue.
- The Telegram body carries the **resume command**, in the same form `halfrun`'s own stop uses.
- **Resuming is `halfrun`'s stop exactly**: a person looks at the working tree and, if it is right,
  carries on from the commit themselves. The stop report carries that resume command too, not only
  the Telegram.

**Stopping is the specification, not a failure.** The label's job is not to keep a batch moving; it
is to stop a batch walking past a decision that was a person's to make.

**What the alternatives could not do is leave the choosing with a person**, and the batch-preserving
one was the early recommendation. Opening the pull request and leaving it unmerged keeps the run
going, and it satisfies **only half** the requirement: a person approves *publication*, but on a
candidate-selection issue the run has already chosen one and committed it, so the person's job
changes from **choosing** to reverting what was chosen. Stopping, stashing and moving to the next
child satisfies both halves and pays in stashes — thirteen children, thirteen stashes, and work that
disappears the first time two are confused. Stopping before the commit and leaving the tree exactly
as it is satisfies both at no such price. The decision in full is joshuafolkken/kit#1125 → `## 決定`.

**Read the answer from `pnpm josh issue:state <N>`, never by matching the label string yourself**
(joshuafolkken/kit#1132). It prints a `human_review: yes` / `human_review: no` line beside the state
and the labels, decided through the same case-insensitive comparison every other workflow label goes
through. GitHub keeps the spelling a label was created with and treats `Needs-Human-Review` as the
same label, so an issue read by eye against the lowercase string is one whose run does not stop — and
the artifact ships, which is the whole thing this label exists to prevent.

**Ask once, before implementing.** `epic:next` prints a bare issue number and `fullrun` / `queue` are
handed one, so nothing has read this issue's labels by the time work would start — the check is one
call of its own, made the moment the number is in hand and before the plan. The confirmation an
`epicrun` makes *after* a delegated child returns reads the same line for free, but that is too late
to decide whether to degrade: by then the child has either committed or it has not.

```bash
pnpm josh issue:state <N>                      # state, labels, and human_review
pnpm josh issue:state <N> --repo <owner/repo>  # a child in another repository
```

**Never apply or remove it**, exactly as strongly as `auto-ok`: a mark a run can clear for itself is
not a mark. Typing the command on an explicit instruction in the current turn is not applying it;
everything else is a proposal, written as an Issue comment and left for the person. The label itself
is created once per repository, by a person:

```bash
gh api repos/{owner}/{repo}/labels -f name=needs-human-review -f color=d93f0b -f description="Implement and verify, but stop before committing so a person can look"
```

**It is not `needs-decision`, and reading it as one breaks two things.** `needs-decision` withholds a
run's *start*; this withholds its *end*. So a `needs-human-review` issue is still offered — excluded,
the artifact a person is meant to look at would never be produced — and a child stopped by it **goes
on holding its repository**, because the uncommitted work is still in the checkout. Read as parked
there, the next child would start `git switch main && git pull` on top of it. **The code encodes both
halves by leaving the label out of two sets**: `scripts/git/issue-labels.ts` keeps it out of
`NOT_DIRECTLY_RUNNABLE_LABELS` — in it, the issue is never offered — and `scripts/epic/epic-busy.ts`
keeps it out of the parked set, in which the checkout would be handed to the next child while the
stopped one's uncommitted work is still sitting in it.

This section is the single source of the rule; `prompts/collaboration-workflow/human-review-label.md`
is a pointer to it (joshuafolkken/kit#1184 rollout of the joshuafolkken/kit#1174 pattern). Each entry
point's own branch stays in its own file — `fullrun.md`, `halfrun.md`, `queue.md`, `epicrun.md` — and
routes here for the definition.

## 2a. The `into <target>` suffix — where the new Issue lands

`kickoff new` / `fullrun new` / `halfrun new` accept a suffix naming the epic the run's artifact
belongs to. Without it the artifact belongs to no epic, and `epic:next` only ever offers an epic's
children — so a forgotten instruction parks that Issue permanently rather than losing it visibly
(joshuafolkken/kit#985). Before the suffix existed the same three lines were typed by hand every
time — the keyword, then two instructions after it, the second there only to say what happens when
the run splits.

```
kickoff new into #909
fullrun new into #909
halfrun new into #909
kickoff new "<title>" into #909
kickoff new into joshuafolkken/kit#909
```

**`into` is the spelling because the alternatives collide with forms that already mean something
else.** `kickoff new #909` reads as the existing `kickoff #N`, and `kickoff new epic #909` reads as
"create a new epic" when what gets created is often a single Issue. `into` can only mean "put what
this run created into #909", and the one sentence holds for a lone Issue and an epic alike.

- **One artifact goes in: the top-level one this run created.** No split, and it is the Issue; a
  split, and it is the epic. The children belong to that epic, not to the target.
- **Insert as soon as the artifact exists** — before implementation in `fullrun new`, before the
  plan comment in `kickoff new`. Left until the end, a run that stops halfway leaves behind exactly
  the orphaned Issue this suffix exists to prevent.
- **The insertion always goes through `pnpm josh epic --add <E> <N> [--before <M> | --after <M>]`.**
  Never hand-edit the epic body: the declaration and the `blocked-by` relations then disagree,
  `epic:next` answers `error`, and an unattended run stops.
- **Decide the position, then record why** — in the target epic's body or as an Issue comment. A
  rationale that exists only in the conversation is not there for whoever next questions the order.
  The position itself follows whatever criteria the target epic has already been ordered by — work
  whose effect compounds over the remaining children goes earlier, and a child already in progress is
  never jumped ahead of.
- **A target that is not an epic is refused, and the refusal names both ways out**:
  `pnpm josh epic --promote <N> <N...>` when it is a request, a discussion or a container, or a new
  epic over both when it is itself one of the deliverables. Never promote on your own — which arm
  applies depends on what the target is. **The command will not choose either**, because promoting
  rewrites someone else's Issue into a container, which is a structural change rather than an
  insertion (the same promote-or-create branch `split-assessment.md` describes). Naming both in the
  refusal is what keeps the run one command away from moving on.
- **A cross-repository target is written `owner/repo#N`** and inserted from that repository's
  checkout; run there, since `epic --add` reads and writes only the repository it runs from. Run in
  the wrong one, it answers with the command to retype rather than a usage list — "Run
  `pnpm josh epic --add 909 985` in that repository's checkout" — and `pnpm josh doctor` prints where
  each checkout is (`prompts/collaboration-workflow/cross-repo-epic.md`). A bare `#N` resolves to
  this repository's issue of that number.
- **No suffix leaves the behavior exactly as it was.**

**It is not `epic:bundle`, and both still run.** `epic:bundle` *recommends* an epic for a newly filed
Issue and does nothing when the signal is weak; `into` is a person naming one explicitly, and the
naming is itself the signal. They are separate routes, so the `epic:bundle` call that follows a
filing happens exactly as before.

This section is the single source of the rule; `prompts/collaboration-workflow/into-epic.md` is a
pointer to it (joshuafolkken/kit#1181 rollout of the joshuafolkken/kit#1174 pattern).

## 2b. Delegating a step to a cheaper tier

**Every step of a run used to execute at the same depth** (joshuafolkken/kit#969). Designing,
assessing a split and reviewing are judgement; applying a fix the gate has already named is not —
and both were billed at the same rate. Delegation is the correction: the steps whose answer is
already decided go to a cheaper execution tier, and the judgement stays where it is.

**Ask before delegating any step of a run**, and use what it answers:

```bash
pnpm josh delegate <step>   # → delegate | keep ; the reason on stderr
pnpm josh delegate --list   # the enumeration, and what was rejected and why
```

**Never decide it yourself.** "This one is simple enough for the cheap tier" is a judgement made
under cost pressure, and cost pressure resolves it toward *cheap enough* exactly when a mistake is
most likely — the same reason `pnpm josh review:level` takes the review level out of an agent's
hands and reads it off the changed paths instead.

**Anything not on the list is `keep`.** A step nobody classified must not be delegated because
nobody said it could not be — the default is the rule, not a fallback. Put the other way: a missed
entry costs money, and a wrong `delegate` costs correctness, quietly.

**A step earns its place by naming how a wrong result is caught** — by something that runs in the
parent tier and costs less than redoing the step. "Unlikely to be wrong" is not that. That is the
substantive one of three conditions: (1) the step can be verified without being redone, (2) a wrong
result is *caught* by that verification, and (3) the row exists on the enumeration — meeting the
first two is not membership until someone adds it.

**A candidate is rejected on one of two arms, and both are recorded.** One arm **names no verifier**
at all: a notification body, a decision-log comment and a status read each ship their mistakes with
nothing left to disagree with them. The other arm has a verifier and is kept anyway, because **a
wrong result propagates too far** to be worth catching after the fact — a wrong root cause produces a
fix that passes the gate, a wrong design is paid for by every step after it, a missed split widens
one Issue into a batch nobody authorized, and a cheaper review finds less of what is left between a
defect and a merge. **Neither arm is the exception**, and reading one as the common case is what lets
a candidate that clears it read as qualifying. `--list` shows both groups as **rejected** rather than
absent, and `pnpm josh delegate <step>` answers `kept deliberately` for a step that was weighed and
`kept by default` for one nobody ever considered — so the next person to propose one finds the reason
instead of re-deriving it.

**The mechanism is not the unit.** How a thing is delegated — an isolated execution unit, an explicit
brief, a result the parent can verify, a failure that surfaces — is separate from what is delegated.
The units are one step of a run (`gate-fix`, `survey`) and one whole child of a batch (`epic-child`,
joshuafolkken/kit#984) — an epic's child under `epicrun` and one issue of a `queue` alike
(joshuafolkken/kit#1149). **They share one mechanism** — one enumeration, one command, one verifier
requirement; building a second is the clone `CLAUDE.md` prohibits. What joshuafolkken/kit#1149
widened is the reach of that one row and not the enumeration, so **no second row like `queue-child`
is added**: the brief, the summary and the verifier are identical, and only the keyword that started
the batch differs. **A batch entry point that does not delegate is the defect**, not a variant:
`queue` accumulated every issue's history in one context until it was wired to this same row, and
the per-issue procedure is `queue.md` → "Each issue runs in a delegated unit".

**`followup-filing` is a third unit — one whole sub-procedure of a run** (joshuafolkken/kit#1892).
The late-run follow-up filing chain — `issue:scout` → file the Issue → `epic:bundle` → `epic --add`
— is a dependency chain `batch:guard` correctly keeps one call per step, so what makes it expensive
is the ~340k context it runs in at a run's tail, not the step count: run #1864 measured eight round
trips there. A fresh unit runs the same chain at a small context, handed the finding text the review
round cap already composed, so its work is the mechanical execution and nothing else. Its verifier is
`epic-child`'s exactly — the parent reads the filed Issue from GitHub with
`pnpm josh issue:state <new>`, not the unit's summary, so a follow-up reported filed but not created
is still absent. **Deferring the chain earlier instead was structurally blocked, which is why the
answer is delegation**: the finding is only known after the review, so it cannot move earlier, and
`epic:bundle` must run before the current Issue closes (`prompts/review.md` → "Review round cap"), so
it cannot move to a later session either. The point of use is that branch-2 filing, and
`batch:guard`'s one-call-per-step verdict is untouched — delegation only moves the chain to a cheaper
context.

**`epic-child`'s verifier is not the child's own completion report.** The parent reads the child's
state from GitHub — `pnpm josh issue:state <N>`, the moment the unit returns — because a child
reported done whose pull request never merged is still open, and a loop advancing on the summary has
discarded the very thing that made the unit delegatable.

**Reading that state is not the same as reading `CLOSED` and calling every other answer a failure**
(joshuafolkken/kit#1147). That is why the command prints a `human_review:` line beside the state
rather than the state alone: **one open answer is the run's own ending rather than an unfinished
child**. A child stopped by `needs-human-review` comes back open **by design** (§2z) — its
`in-progress` stays on, because the uncommitted work a person is meant to look at is still in the
checkout and the child must go on holding its repository, and it is never counted against the
consecutive-failure guard. Read as a failure there, the parent strips that label, releases the
repository, and hands the next child a `git switch main && git pull` on top of that uncommitted
work — the exact event joshuafolkken/kit#1125 filed the label to prevent — while a stop that went
exactly to specification is tallied as an environment fault. **The classification itself belongs to
the per-entry procedure**, and both entries carry every branch of it: `epicrun.md` → "Each child
runs in a delegated unit" and `queue.md` → "Each issue runs in a delegated unit". The enumeration
itself is `scripts/delegation/delegation-policy.ts`, printed in readable form by
`docs/josh-commands.md` → "`josh delegate`".

### The pre-implementation reading — what goes to a unit, and from which file

**The investigation in front of an implementation is reading, and reading is what a delegated unit is
for** (joshuafolkken/kit#1426). Run #1406 (PR #1422) spent **494 seconds — 18.0% of a 45.8-minute run
— before its first edit**, of which **443 s (89.7%) was model wait and 51 s (10.3%) was tool
execution**: 40 turns, 43 calls. **The tools cost almost nothing.** What cost was the round trips
*after* what had been read piled up in the main line — 18 `Read` calls, over 150,000 characters,
riding in the prompt of every later turn, with the run's four largest waits (72.2 / 51.8 / 44.0 /
43.4 s) all falling after a large read in its second half against a per-turn average of 8.8 s.

**The line is what the file is for, not how large it is.** Reading to understand the Issue's subject
goes to the unit; reading a file this run is about to edit stays in the main line, because the main
line cannot issue an `Edit` against text it does not hold.

**What comes back is the conclusion plus the `file:line` citations that support it — never the file
text.** Returning the text puts the whole cost back where it was and buys nothing. A throwaway probe
script is written, run and deleted inside the unit, which returns its output alone.

**The threshold is 3 files, and it is a count, not a forecast: the read that takes the count of files
the run will not edit up to it is where the reading goes to a unit of its own.** The ones below it stay
in the main line, and **the unit is not sent back over them** — the brief carries what the main line
already concluded from them, and the unit reads on from where the count tripped, so nothing is read
twice and no conclusion rests on a third of the evidence. Delegating costs two extra
main-line turns — one to write the brief, one to read the result — which at run #1406's measured 8.8 s
of model wait per turn is about **18 seconds**; the fork's own reading is work that would have been
paid either way. Against that, one subject file of that run's average size (~8,300 characters, ~2,100
tokens) is re-sent on every remaining turn, and the run's own second half puts the turns following its
large reads at 43–72 s against that 8.8 s average. So one file already sits near the break-even and
three (~25,000 characters, ~6,300 tokens carried) is several times past it, while at one or two the
brief itself costs about what reading the file would — which is why the number is 3 rather than 1.
**Counting is what removes the judgement**: the reads are counted as they are made rather than
predicted before the investigation starts, so a small investigation never trips it and pays no
overhead at all. The number is derived from run #1406's figures rather than from a controlled
comparison, and `pnpm josh delegate --list` prints it — the verdict command prints the verifier, so it
is the listing that carries the count.

**A delegation resets the counter rather than spending it, and `pnpm josh investigation:guard` is what
counts** (joshuafolkken/kit#1460). Measured on run #1441 the question was asked once, at t+4.0 min, and
the main line then read **8 more files it did not edit** — over twice the threshold — without it ever
being asked again: a count kept in an agent's head is a one-shot judgement, and after a delegation a run
remembers the *step* as done rather than the *counter* as zero. So the counting happens in a
`PreToolUse` hook that reads the transcript, and the read that reaches the threshold is **refused**
rather than commented on — the conclusion joshuafolkken/kit#1390 reached after joshuafolkken/kit#1344
measured three consecutive runs in which prose and a live notice moved the number not at all. A
delegation clears the pending set, three more unedited files rebuild it, and the refusal fires again;
**one refusal per accumulation** keeps a false positive costing a single round trip instead of wedging
the run. **The other way a refusal re-arms is another accumulation, and until
joshuafolkken/kit#1764 the code did not do it**: only a delegation cleared the disarm, so a run that
*ignored* its one refusal — read on and never delegated — was never spoken to again however many
unedited files it went on to open. The one run this threshold exists for was the one run the guard
fell silent on. Measured over 296 recorded sessions and 3,064 main-line reads, **1,132 of them — 36.9%
— reached the threshold and were let through**; with the arm in place that falls to 920 and the
refusals rise from 184 to 396. Reads of a file the run itself edits (827) and reads below the
threshold (921) are untouched by the change, which is the check that it moved only what it was meant
to. **The guard refuses nothing inside a delegated unit** (joshuafolkken/kit#1840): a unit is already
where this rule sends the reading, and a read-only one has no `Agent` tool to dispatch with, so a
refusal there — even the single first one it was formerly degraded to — asked for an action the unit
could not take. `pnpm josh time`'s `Investigation reads:` block prints those four figures for one run,
from this guard's own predicates rather than from a second reading of the rule. A file this run
**edits is never counted, before the edit or after it** (joshuafolkken/kit#1840): reading something
this run will edit is the main line's, so a re-read of a file it has already edited is not counted as
fresh investigation either. `docs/josh-commands.md` →
"`josh investigation:guard`" carries which shell commands count as reading, why it is wired to `Read`
and `Bash`, and the `JOSH_INVESTIGATION_GUARD` off-switch.

**The main line does not idle while the unit reads** (joshuafolkken/kit#1764). Measured on
`fullrun #1783`, the unit cost $1.71 and 6m30s and the main line spent **4m42s of it waiting on
`pnpm josh run:progress --wait`** — so the delegation did not replace any reading, it added six and a
half minutes in front of it. A delegated unit is a command that takes minutes, and §2h already says
what runs beside one: the work that writes nothing the unit's result depends on. Here that work is
named rather than judged — **read the files this run is about to edit**, which stay in the main line
by definition and are needed before the first `Edit` either way. Start the unit, read those, then read
what it returned.

**And when the investigation needs more than one unit, they go out in a single fan-out turn — not one
after another** (joshuafolkken/kit#1847). Measured on `fullrun #1839` (run body 54.8 min), the `setup`
phase — run start to first edit — was **16.6 min, 30.3% of the run**, and three of the five longest
gaps in the whole run fell inside it (170.1 / 144.1 / 106.3 s, **7.0 min, 12.8% of the run body**).
Each of the three sat in front of a *serially* launched investigation unit — the lane-machinery map at
t+1.7 min, the API signatures at t+7.3 min, the registry and log paths at t+11.4 min — and the long
think was not a read but the composing of the *next* brief once the previous unit had returned. **The
three questions needed nothing from one another**, so composing them one at a time is the whole cost:
issued together in one turn, the way §2h already issues every call that needs no other's result, the
three serial thinks collapse to one. This is the turn-batching principle (§2h) reaching the `Agent`
launches the round-trip batcher never sees — the launches are spread across `setup` with reads between
them, so they are never the consecutive single-call turns `pnpm josh batch:guard` fires on.

**The condition is independence, and it is read from the questions rather than assumed.** Before
dispatching, ask of each brief whether it could have been written at the *start* of the investigation:
the ones that could go out together, and only a brief that genuinely cannot be written until an earlier
unit has answered waits for that answer — fanning such a pair out would merely launch a unit asking the
wrong question. So the collapse is claimed only where the questions are actually independent, which on
`fullrun #1839` the three were (a lane-machinery map, API signatures, and a registry-and-log-path read
are three separable questions).

**Enforcement was investigated and is not implemented, for the same reason the round-trip batcher
misses the pattern.** A guard would have to see an earlier solo `Agent` launch at the moment a later
one fires, but the two are minutes and many turns apart and the earlier one falls outside the
transcript tail the hooks read (the 256 KB window in `time-density-hook.ts`); and independence between
two free-text `Agent` briefs exposes no mechanical target to compare, the way `pnpm josh batch:guard`
compares file paths and commands — so a guard would either refuse every second investigation unit,
genuinely serial chains included, or need a test it cannot make. This rule is therefore carried in
prose here rather than as a `PreToolUse` refusal, the same conclusion the chain rule records for its
own step that no tooling can enforce. **What measures whether it held is not a guard but `pnpm josh time`**:
joshuafolkken/kit#1854 added a second recoverable-round-trip series that counts exactly these
spread-apart independent launches — turning on the same independence test this rule does, where a
write or a prior-finding reference between two launches marks the later one dependent and keeps it out
of the group — so the `setup` phase, its `gaps.longest` block and that bundle count together say
whether the fan-out happened.

**Where the Issue already names the location, the reading is not delegated at all.** The same run
measured this from the other side: #1783's body had already identified the defect as two rules in the
distributed eslint configuration, the unit added almost nothing to that, and the main line then
re-opened the very files it had cited. **The condition is what the Issue says, not how big the subject
looks** — a body or a comment that names the file, the function or the rule has done the unit's job,
and the reading that follows it is reading of a file the run is about to edit. **The threshold is
unchanged and so is the verification path**: what comes back from a unit is still the conclusion plus
its `file:line` citations, and the parent still opens those lines. What this removes is a delegation
whose whole output was a location the run already had.

**One trigger, deliberately.** A second arm on characters read would need a tie-break against the file
count, and neither number is measured more precisely than the other — so the character figures above
are the derivation of the one number and not a second rule.

**It is not `survey`, and it is not `diagnosis`.** `survey` reports *where* something appears and is
checked by one `grep` of what it claimed; this reports *how the subject works* and is checked by
opening the lines it cited. `diagnosis` stays **kept**: the unit reports what the code does, and what
that means and what to change is the main line's, so a unit that returned a root cause would be
delegating the rejected row under this row's name.

**The whole of §2b — the subsection above included — is the single source of the rule**;
`prompts/collaboration-workflow/delegation.md` is a pointer to it (joshuafolkken/kit#1183 rollout of
the joshuafolkken/kit#1174 pattern).

## 2c. The `owner/repo#` prefix — which repository the run acts on

Every entry point takes the target repository in front of the Issue reference. Without it the target
is the repository the session runs in, which is why a conclusion reached in one repository could only
be filed into that same one and a person had to say the destination out loud every time
(joshuafolkken/kit#904). `kickoff`'s three filing commands all left the path on this repository, and
reaching a conclusion in one repository about a different package is daily rather than exceptional.

```
kickoff joshuafolkken/kit#412
kickoff kit#new
kickoff kit#new "<title>"
fullrun joshuafolkken/app-kit#12
halfrun kit#412
queue kit#1 kit#2
epicrun joshuafolkken/kit#858
```

- **One definition, every entry point.** The notation was not invented here: `epicrun
  joshuafolkken/kit#858` was already defined as the way to name an epic in another repository, and
  **only the entry points had been left out of it** — so the definition sits in this one section and
  every entry point references it rather than restating it, the correction joshuafolkken/kit#865 made
  for the split assessment. The prefix goes where `#N` goes, so no new keyword is added, and
  `owner/repo#new` stands in the same slot as `owner/repo#N`.
- **A short name expands by prefixing the session repository's owner** — `gh api repos/{owner}/{repo}
  --jq .owner.login` — and **never by searching kit#869's map**, which answers where a checkout is
  rather than which repository is meant. A short name therefore satisfies the first-party test (owner
  equality) by construction — the same gate `repo_map_logic.is_same_owner` puts in front of every
  discovered entry — so **there is structurally no path by which a short name resolves to a
  third-party target**, and a repository that is not checked out here is still a valid `kickoff`
  target. A name that does not exist fails as `gh` not found: report it, never read it as a near-miss
  for another name — silently correcting a typo writes into a repository nobody named.
- **It is not the standing prohibition on a bare `#N`.** What that forbids is a bare *Issue number*,
  which resolves without complaint to a different issue of the same number in whichever repository is
  read; a bare *repository* name whose owner is determined has no such failure mode.
- **An explicit owner that is not the session's is a third-party target, and it stops the run.** The
  claim above covers short names only; `fullrun <other-owner>/repo#12` names a tracker we do not own,
  and every write there — Issue, comment, PR — is Tier C (`CLAUDE.md` → "Third-party repositories are
  Tier C"). **Decide it mechanically**: whether the owner equals what `gh api repos/{owner}/{repo}
  --jq .owner.login` returns, with no judgement in between. Typing the prefix is not the explicit
  instruction that rule requires. **Send a `confirmation` Telegram and stop — that is the whole action
  here**: nothing has been produced yet, so there is no finding to record under `## Upstream
  candidate` and no draft to prepare; that procedure belongs to an upstream defect found mid-run.
  Being able to pass `-R` is not authorization — what goes out lands on someone else's tracker, and
  neither the notifications nor the indexing can be taken back afterwards.
- **No prefix leaves the behavior exactly as it was** — the target is the session's repository.
- **`kickoff` needs no checkout**: name the target repository in the path of every `gh api` call —
  reading, creating, updating, commenting and creating a label alike — and never clone. **The read is
  where it is forgotten, and forgetting it passes silently**: leave the first call of
  `kickoff joshuafolkken/kit#412` on `repos/{owner}/{repo}/issues/412` and the plan is written against
  this repository's issue of that number, with no error anywhere. The one exception is the split
  path's epic, since `pnpm josh epic` only writes the repository it runs in — run it in that
  repository's checkout, or fall back to `gh api repos/<owner/repo>/labels …` followed by
  `gh api repos/<owner/repo>/issues -f title="<epic-title>" -f 'labels[]=epic' -f body="<body>"`, and report that `epic:check` could not
  be run: never report as checked something that was not checked. **The promote arm has no such
  fallback**: `--promote` writes only its own repository too, and creating an epic instead would leave
  `#N` neither promoted nor tracked, so with no checkout there, file the children and stop.
- **The implementing entries require a checkout and never create one — when the target is another
  repository.** A prefix naming the session's own repository changes nothing: `fullrun kit#412` in
  the kit checkout behaves exactly as `fullrun #412`, stash step included. Otherwise resolve the
  checkout from `pnpm josh doctor`'s map (joshuafolkken/kit#869); **no checkout there, or a tree that
  is not clean, stops the run** with a `confirmation` Telegram — cloning decides the layout of
  someone's machine for them, the same judgement kit#869 made when it prints a repository that is not
  checked out rather than cloning it, and a dirty tree holds work that is not yours to stash or
  discard (each entry's own "stash what is in the tree" step covers the session's repository, never
  someone else's checkout). Otherwise the commands that act
  on the target, from `git switch main && git pull` to `pnpm josh followup`, execute in that
  checkout — **a command naming a different repository still runs where that repository is**, which
  is why a cross-repository `into` insertion runs in the epic's checkout (§2a).
- **`epicrun` is exempt from the whole bullet above**: `owner/repo#E` names where the *epic* lives,
  not where its children are implemented. Its state is read against that repository through
  `gh api`, so that repository needs no checkout and a missing or dirty one never stops the launch.
  The checkout rules bind each child at implementation time, against **that child's** repository,
  and which session runs which child stays "Concurrency" in `epicrun.md` — one session per
  repository.
- **Independent of `into <target>`**: this says which repository the run acts on, `into` says which
  epic the artifact joins, and both may need qualifying in one line — `kickoff kit#new into
  joshuafolkken/kit#909` is one correct line.

**It is not resident, and §3's criterion is why.** The notation first binds *after* a keyword has been
typed, and by then this skill has been read (`CLAUDE.md` → "Read the skill before running any part of
a command"), so the question "must it fire on a turn where no skill was loaded?" answers no — the same
reason `into <target>` (joshuafolkken/kit#985) lives in this skill, its topic file a pointer too.

This section is the single source of the rule; `prompts/collaboration-workflow/target-repo.md` is a
pointer to it (joshuafolkken/kit#1182 rollout of the joshuafolkken/kit#1174 pattern).

## 2d. A prerequisite discovered mid-run — a dependency, not a park

**A prerequisite discovered mid-run is a dependency, not a park.** Finding that something else in
*this* repository has to land first is a third situation, distinct from an upstream defect and from a
split: the Issue in hand is still one deliverable, it just needs another one before it.

**Four kinds of other work turn up mid-run, and the procedure differs for each.** Reading one as
another is the failure this section exists to prevent: a prerequisite was the only one of the first
three with no procedure of its own, and the two it sits between both end in a stop, so the nearest
written rule was the one that parks (joshuafolkken/kit#891). **The fourth had no procedure either,
and its fallback was worse than a park** — a plain observation belongs to none of the three, changes
nothing about the Issue in hand, and a run reaching it handed the judgement back to a person; §2i is
its procedure (joshuafolkken/kit#1649).

| What turned up                                                              | What to do                                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A defect originating in **another package**                                 | File the upstream Issue and **stop** — Tier A for a first-party target; a third-party one is Tier C, recorded and drafted rather than filed (`CLAUDE.md` → "Cross-package problems"; `prompts/collaboration-workflow/upstream-interrupt.md`) |
| This Issue was really **several** (a split)                                 | File the children and the epic and **stop** — except under `epicrun`, whose authorization already covers a batch, so the children are filed and run through (`split-assessment.md`) |
| Another Issue in **this** repository has to land first (**a prerequisite**) | This section                                                                                                            |
| Something worth filing that is **none of the three** (**an observation**)   | File it **without asking** — Tier A for a first-party target — and **carry the run straight on**: nothing is stashed, nothing is parked (§2i). **A delegated child does not file here**, and a filing at depth 1 or deeper cites the depth-0 work it blocked; **one that cannot cite it goes to `docs/observations.md` and is filed on its second sighting** rather than being dropped — all of them §2i's |

**File the prerequisite with the `route:tier-a` label**, so a Tier A filing made during
implementation stays countable by filing route afterwards (joshuafolkken/kit#1083). **This paragraph
belongs to the prerequisite row, not to the table** — the label means a filing the run is *blocked
by*, so the observation row carries no `route:` label of its own (§2i):

```bash
gh api repos/{owner}/{repo}/issues -f title="<title>" -f 'labels[]=route:tier-a' -f 'labels[]=depth:<n>' -f body="<body>"
```

Every "file the prerequisite" below means that labelled filing, and it always happens **first**: the
steps after it have to name a number that does not exist until it is.

**`pnpm josh issue:scout "<title>"` goes in front of that call, exactly as it does for a `new` entry**
(§2e, joshuafolkken/kit#1679). A filing made mid-run is the one most likely to duplicate something —
it is about the work the run has just been looking at — and joshuafolkken/kit#1656 is that case
exactly: a `route:tier-a` filing covering work that had merged about five hours earlier.

**Each entry point's own branch stays in that entry's file**, which is where the numbered procedure
lives:

- **`epicrun`** files without confirmation, records the dependency with
  `pnpm josh epic --add <E> <N> --before <M>` — `<E>` the epic, `<N>` the prerequisite just filed,
  `<M>` the child in hand — and the run **continues rather than parking it**
  (`epicrun.md` → "A prerequisite discovered mid-run"). **The letters differ by entry file**:
  `fullrun.md` and `halfrun.md` write the same two Issues `#<P>` and `#N`, so read them from the file
  you are in rather than carrying them across. Parking is only for a prerequisite that
  *cannot* be expressed as a dependency — one needing a design decision nobody has made, a Tier B
  toss-up, or a Tier C action. Parking one that can be expressed inverts the point: `needs-decision`
  is cleared by a person, so a park taken in the name of unattended execution is what makes the run
  need one.
- **`fullrun` / `halfrun`** file the same way without asking, insert the prerequisite into the epic
  that already tracks the Issue or create one over both, and then **stop**, leaving the person one
  command to type (`fullrun.md` / `halfrun.md`). The stop stays because typing `fullrun` approved
  implementing **one** Issue and a batch is a different authorization; what the filing removes is
  every confirmation in front of it, not the stop itself.

**Two steps every entry's procedure turns on**, both load-bearing rather than tidy-up:

- **`git stash push -u` — the `-u` is not optional.** The work in progress almost always includes a
  new `*.test.ts`, which is untracked, and a stash without `-u` leaves exactly those files in the
  tree — for the next child's `git switch main && git pull` to refuse, or to carry into the
  prerequisite's branch and PR.
- **The Issue comment is what gets the stash popped, not the Telegram.** The run that later picks the
  paused Issue up reads that comment and pops before implementing; a stash recorded only in a
  Telegram message is orphaned work. Say it in the Telegram too — the comment is the record.

**Automatic filing is capped at 10 Issues per run** at every entry point, the guard `epicrun` already
carried. Removing the confirmation removes the only thing that stopped a chain of false positives, so
a ceiling replaces it; on reaching it, stop and report. `kickoff` is exempt — it never implements, so
it never discovers one.

This section is the single source of the rule; `prompts/collaboration-workflow/prerequisite-issue.md`
is a pointer to it (joshuafolkken/kit#1185 rollout of the joshuafolkken/kit#1174 pattern).

## 2e. Before filing a new Issue — `pnpm josh issue:scout`

**Every filing asks two questions before it happens, and one command answers both.** Run it
the moment the title exists and **before** the `gh api … issues` call that creates the Issue:

```bash
pnpm josh issue:scout "<title>"                                   # alias: josh isc
pnpm josh issue:scout "<title>" --body "<one-line summary, citing #N where the work follows one>"
```

**Both answers were assembled by hand before this existed, and differently every time.** A measured
`fullrun new` spent **7 minutes 32 seconds — 22% of the run** listing epics, fetching their children
and running six duplicate searches before implementation started, and then filed work that two open
issues already covered — one of them filed **three minutes earlier by another session**
(joshuafolkken/kit#1252). The same two answers now take about four seconds, and they are the same two
answers every time rather than whatever that run's search happened to cover.

- **`Duplicates:` is read, not skimmed.** Open each candidate. When an **open** one covers the same
  work, **do not file**: send a `confirmation` Telegram and stop with the command to run against the
  existing Issue — "Please run `fullrun #<existing>` to execute this Issue." A second Issue for work
  already tracked is what this step exists to prevent, and it is invisible afterwards. When none of
  them covers it, say so in one line and carry on filing.
- **A candidate marked `(closed)` is a different answer, and it is the one that was missing.** The
  scan covers what closed recently as well as what is open (joshuafolkken/kit#1679), because the work
  most likely to be filed twice is the work that just finished. A closed candidate that covers the
  same work means **the work is already done**, not that it is tracked elsewhere — so there is
  nothing to run and no `fullrun #<existing>` to hand over. Verify it against the merged code, and
  then take the exit in §2g → "When the work turns out to be already merged". A closed candidate that
  does *not* cover the work is noted in one line and the filing carries on, exactly as an open one is.
- **`none` is an answer.** The command reports no candidate rather than the closest miss, so a `none`
  is a scan that found nothing — not a scan that was not run.
- **`Epic:` front-loads the placement.** Its recommendation is `epic:bundle`'s, which makes
  `add_to_epic` / `create_epic` Tier A and `ask` a stop, in exactly the reading §2a's `into <target>`
  suffix would have given by hand. Where the user typed `into <target>`, that naming wins — it is a
  person naming the epic explicitly — and the scout's epic line is then confirmation rather than a
  decision.
- **`Epic: not asked` is not `Epic: none`.** The epic half decides from the issue numbers the summary
  names, so a title-only call gives it nothing and it says so rather than answering "file it
  standalone". **Pass `--body` whenever the work follows an existing Issue** — one line citing `#N` is
  enough, and naming the epic itself (`part of epic #<E>`) is answered with that epic. Without one,
  the epic printed beside a duplicate candidate is the placement answer.
- **It does not replace `epic:bundle`, which still runs after the filing.** This one answers about an
  Issue that does not exist yet, from a title; that one answers about an Issue that does, from its
  number and its recorded relations, and its answer can differ once the Issue is real. Both calls
  happen — the scout before the `issues` call, `epic:bundle` after it.
- **Every filing route runs it, not only a `new` entry point** (joshuafolkken/kit#1679). The scope
  used to be the `new` entries alone, which left the routes that file *during* a run — §2d's
  prerequisite, §2i's observation, and the review round cap's branch-2 filing — outside the one check
  that would have caught a duplicate. joshuafolkken/kit#1656 was filed by exactly that gap: a
  `route:tier-a` filing made mid-run, covering work joshuafolkken/kit#1623 had merged about five
  hours earlier. **The trigger is the `gh api … issues` call, never which keyword started the run** —
  if this run is about to create an Issue, the scout goes in front of it.
- **A `#N` entry point does not run it *for the Issue it was handed*.** `fullrun #N` / `halfrun #N` /
  `kickoff #N` are given an Issue that already exists, so there is nothing to file and nothing to be
  a duplicate of. That says nothing about an Issue such a run goes on to file later, which the bullet
  above covers.
- **The split path files each child through the same step** — a split is several filings, and each one
  can duplicate something already open. The epic itself is not scouted: it is created over children
  that were, and `epic:bundle` is what places it afterwards.

Full behavior, the thresholds and why the duplicate half compares titles rather than bodies:
`docs/josh-commands.md` → "`josh issue:scout`".

## 2f. The working-tree hold — one run per tree

**Ask `pnpm josh run:hold` before anything else, and obey what it answers.** It is the first call of
`fullrun` and `halfrun` alike — before the title is normalized, before `git switch main`,
and **before a `new` entry files its Issue**, because a run stopped after the filing has already left
behind the artifact it should not have created.

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

**The unit is the working tree, and `epic-busy.ts` is not reused for it** (joshuafolkken/kit#1091).
That read answers about a *repository* and implements `epicrun`'s one-child-per-repository rule; what
these entry points contend for is one branch, one index and one uncommitted diff, and a linked work
tree has its own three. Asked here, the repository-scoped question would stop a second work tree's
legitimate run. **`epicrun`'s own guard is unchanged** — the two layers guard different resources, and
neither replaces the other. An `epicrun`'s children run this one as any `fullrun` does, one after
another in the same tree.

**`kickoff` does not claim it, and that is an exemption rather than an omission**
(joshuafolkken/kit#1799). What these entry points contend for is one branch, one index and one
uncommitted diff, and `kickoff` touches none of the three: it reads the Issue, normalizes the title,
posts the plan, notifies and stops, every one of those against GitHub. Claiming for it stopped
planning work for the length of an unrelated run, over a resource that run was never going to
disturb. **It is a fact about the command rather than a judgement made at the entry** — "this one is
small, it will be fine" is still the judgement the paragraph below refuses — and it changes nothing
for `fullrun` or `halfrun`, which do edit the tree and claim exactly as before.

**Claim it in the checkout the run will edit.** The record is keyed to the work tree the command runs
in, so a cross-repository `fullrun owner/repo#N` resolves that repository's checkout from
`pnpm josh doctor` **first** — that resolution is a read and writes nothing — and claims there;
claiming in the session's own tree would guard the one tree the run never touches.

**A release names the run it belongs to** (joshuafolkken/kit#1799). `pnpm josh run:release <N>`
removes the record only where the record names `<N>`, the bare form only the unnumbered run's, and a
record belonging to anything else answers **`held`** and is left standing. Until then the command
removed whatever was there — and the `busy` stop below is what sends a person to type it, on a
judgement about staleness made from outside the run that wrote the record, so the guard's own
recovery instruction was a way to free a live run's tree. **`pnpm josh run:release --force` is the
one spelling that removes a record this run did not write**, and the stop message names it rather
than the ordinary one.

**Release what the claim recorded, which is not always the Issue number.** A `#N` entry claimed `<N>`
and releases `<N>`; a **`new` entry claimed before its Issue existed**, so its record carries the
unnumbered run and it releases with the **bare** form however many numbers the run has acquired
since. Nothing re-keys a record after the filing — the claim has to come before it, which is the
whole reason the bare form exists — so a `fullrun new` that stops on a split types
`pnpm josh run:release`, not `pnpm josh run:release <N>`.

**Releasing is the run's, not a person's memory.** `pnpm josh followup` releases the hold on a merged
run — the seam every `fullrun`, and every child of an `epicrun` or a `queue`, passes through — and a
record abandoned by a crashed session expires after 8 hours rather than locking the tree for good.
**A stop that leaves the tree clean releases it explicitly**: a `fullrun` / `halfrun` that stops on a
split, a prerequisite or a third-party target ends with `pnpm josh run:release <N>` — bare where that
run entered as `new`, per the paragraph above — because in each of those the tree carries nothing. **`halfrun`'s stop before
commit keeps the hold**, and so does a `needs-human-review` stop: the uncommitted work still in the
tree is exactly what a second run would trample, so the release command goes in the stop report and
the Telegram for the person to type once they are done with it.

**Those two stops are held across a person's latency, not a run's, and no expiry could be sized for
them** — so the age is not what decides. **An expired record over a tree that still has uncommitted
changes does not free it**: the command answers `busy` and says to commit, stash, or release once the
work is done. Only an expired record over a clean tree is replaced, which is the crashed run the
expiry was written for — and a stop whose work is already committed and pushed, such as a run halted
by a standing High finding, is deliberately in that second group: the branch is safe on the remote,
so freeing the tree after eight hours loses nothing.

**The batch entry points claim per child, not per batch.** `epicrun`, `queue` and `backlogrun` never
call it themselves; each child runs the `fullrun` procedure, so it claims on entry and `pnpm josh followup`
releases it at that child's merge, leaving the tree free for the next child and held against anything
else for the whole time a child is in flight.

**It answers, so the entry point does not judge.** "This one is a small change, it will be fine" is
the judgement made under time pressure that produced the incident this guard was written after, and
it is the shape `pnpm josh delegate` refuses to leave to an agent for the same reason. The command's
behavior, the answer table and the incident are `docs/josh-commands.md` → "`josh run:hold` /
`josh run:release`"; this section is the single source of the procedure.

## 2g. An Issue's comments are part of the Issue

**Every `#N` entry point reads the Issue's comments before it implements** — `fullrun`, `halfrun`
and `kickoff` (joshuafolkken/kit#1319). A `queue` issue and an `epicrun` child inherit it rather than
restate it: each runs in a delegated unit executing `fullrun`'s procedure, and because the hook keys
its once-per-run record on the *fork's* transcript (§2b, joshuafolkken/kit#1424) every child is
delivered to in its own right. The read is one call, made in the same turn as whatever else the run
already needs:

```bash
pnpm josh issue:read <N> [<N> ...]     # body and comments, one call per batch; alias: josh ird
gh api repos/{owner}/{repo}/issues/<N>/comments --jq '.[] | {user: .user.login, created_at, body}'
```

**The first line is the one to type, and the second is what it replaced** (joshuafolkken/kit#1715).
The body and the comments are two reads that need nothing from one another, so typed by hand they are
two `gh api` calls — and measured over four recorded `backlogrun` parents, `issue bookkeeping` was the
single largest contributor to the parent's turn count, 110 of 414 turns (26.6%), with one issue read
at a time its dominant shape. `pnpm josh issue:read` answers both for every number named, in one call,
and **says when a comment listing could not be read rather than showing no comments** — which matters
here more than anywhere, because the rule below is that the later text wins and a comment nobody read
cannot win anything. The `gh api` form stays for a **cross-repository** read: the command takes no
`--repo`, since the comment listing it uses reads the repository it runs in.

`gh issue view <N> --comments` prints the body and the comments together and is the one to type by
hand — but it is GraphQL-backed, a cloud session is answered `403`, and `scripts/gh-document-guard.test.ts`
refuses it in a runnable block for exactly that reason. The REST call above is the portable form.

**This repository writes its agreements into comments and then reads only bodies.** `CLAUDE.md` →
"Decision autonomy" requires a Tier A decision to be logged as an Issue comment; the review round
cap requires a dropped finding's disposition to be recorded; `epic:plan` writes each decision to the
epic's `## Decisions` **and** to a comment on the child; a stash left behind is recorded on the
Issue. **The place a run is told to write is the place it was never told to read.** Nothing in a
body says it has been superseded, so the mistake is silent: on joshuafolkken/kit#1304 neither review
round, nor the verification gate, nor CI noticed that part of the work had been handed to
joshuafolkken/kit#1307 seventeen minutes before implementation started.

**What the reading is for**, so it is not skimmed: the boundary of the scope — work a comment moved
to another Issue, or added to this one; the record of an auto-decision already made; a split or epic
agreement reached after filing; a recorded stash or an in-flight branch; and a **correction of the
body's own diagnosis** — joshuafolkken/kit#1537's body named the wrong cause and two comments
overturned it, and joshuafolkken/kit#1520's comment changed a default and added an acceptance
criterion the body still does not carry.

### When a comment contradicts the body

**The later text is the agreement in force.** A body is written first and is not rewritten when a
decision arrives, so of a body and a comment that disagree the comment is the newer of the two and
wins. **This is settled by ordering, never by judging which reads better.** Name in the two-layer
work summary which comment superseded what, so the person sees the substitution before the work
starts.

**Two answers are not the run's to make, and each is decided from what the comment says:**

- **A comment that reassigns part of the scope to another Issue** takes that part out of scope: do
  not implement it, whatever acceptance criteria the body still lists, and name the Issue it went to
  in the completion report. Implementing it anyway is joshuafolkken/kit#1304 exactly.
- **A comment saying the Issue no longer has a reason to exist** — the defect does not reproduce, or
  it was fixed elsewhere — takes the exit in the next subsection, "When the work turns out to be
  already merged". Closing an Issue is Tier C, and a run that quietly implemented nothing would
  report success on work nobody did. **A comment is one of the two ways a run learns this and not a
  case of its own** (joshuafolkken/kit#1679), which is why the procedure sits below rather than here.

Everything else is the ordinary work of the run, **a widened scope included**: a widening large
enough to be several separately-mergeable deliverables is the split assessment's business
(`split-assessment.md`), and not a second kind of stop.

### When the work turns out to be already merged

**A run can learn its Issue is already done in two ways, and both end here** (joshuafolkken/kit#1679).
A **comment** says so — the bullet above — or the **run itself verifies it**, by reading the merged
code and finding every acceptance criterion already satisfied. The two differ only in where the claim
came from; what is left to do afterwards is identical, so there is one procedure and not two.

**Before this, only the first had one, and the second had no exit that was not Tier C.** `fullrun
#1656`, run as a child of the `backlogrun` of 2026-09-09, verified line by line that its work was
already in `main` from joshuafolkken/kit#1623 — and then **closed the Issue itself**, which is Tier C
and not a run's to do. The verification was sound; the child simply had nowhere to put the answer.
**Parking it is not that place either**: `needs-decision` means "waiting for an answer nobody has
given", and here the answer exists — so a person clearing the label puts the Issue straight back into
the offer and the next run repeats the same investigation.

**The exit is the `already-done` label.** It is `needs-decision`'s counterpart rather than a second
spelling of it: `epic:next`, `backlog:next` and `auto-ok:next` all stop offering the Issue
(`scripts/git/issue-labels.ts` → `NOT_DIRECTLY_RUNNABLE_LABELS`, `epic-classify.ts` → `human`), and
`epic:busy` stops counting it as holding a lane, because the run that applied it committed nothing
and left a clean checkout. **Only a person removes it, by closing the Issue** — taking it off asserts
the work is *not* done, which is the same Tier C claim in reverse.

```bash
gh api repos/{owner}/{repo}/labels -f name=already-done -f color=6f42c1 -f description="Verified already merged — a person closes it" --silent 2>/dev/null || true
gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=already-done'
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true
```

The procedure, in order:

1. **Record the evidence as an Issue comment, before the label.** Name the pull request or commit
   that merged the work and, for each acceptance criterion the Issue states, the file and lines that
   satisfy it. **A claim with no citations is not the finding this exit is for** — it is the
   suspicion that sends the run back to implementing.
2. **Apply `already-done` and remove `in-progress`** — the two commands above. Leaving `in-progress`
   on holds a lane against an Issue nothing will ever run.
3. **Commit nothing, push nothing, open no pull request.** There is no change to gate, no review to
   run and no `pnpm josh followup` to reach; the tree is clean, so release the hold with
   `pnpm josh run:release <N>`.
4. **Then behave as the entry point does for a parked child.** A `fullrun` / `halfrun` a person typed
   sends a `confirmation` Telegram naming the Issue and the merge that already covers it, and stops.
   An `epicrun` / `queue` / `backlogrun` child is park-and-continue: no Telegram of its own, the
   finding named in the summary it returns, and the batch moves to the next child
   (`epicrun.md` → "park and continue").
5. **Never close the Issue.** That is Tier C at every entry point, and the label is what leaves the
   close one click away for the person who owns it.

**Nothing about this is a license to skip the work when it merely looks familiar.** The bar is step
1's citations: a criterion you cannot point at merged code for is a criterion this run still owes.

### A long thread

**The fetch is one call however long the thread is; what costs is carrying it afterwards** — which is
why the call above projects each comment down to its author, its timestamp and its body rather than
taking the whole payload. Once the thread runs longer than the Issue itself it is exactly the
pre-implementation reading §2b describes: brief a delegated unit to return **the agreements in force
plus the comment URLs that carry them**, never the comment text. That is the same rule applied, not
a second one — nothing is skipped, and what reaches the main line is the conclusion.

**`pnpm josh rule:guard` refuses the body-only read** and hands over the reissue and the conflict
rule at the moment they bind (`prompts/collaboration-workflow/rule-delivery.md`,
`scripts/rules/delivered-rules.test.ts`). The refusal reaches Claude Code alone and fires once per
run, so **this section is the rule and the hook is what makes it hard to walk past** — a session
that runs no hooks still owes the read.

## 2h. A command that can take minutes is issued in the background

**The rule and its whole procedure are `background-commands.md`, read at its point of use — before
backgrounding the first long-running command (`pnpm josh gate`), and again wherever a run backgrounds
one afterwards.** It governs issuing `pnpm josh git -y`, `pnpm josh gate` and the CI wait detached
while `pnpm josh followup` stays in the foreground, the guarantee that the turn never ends at the
push — bar a dispatched lane child's pre-gate cut (`pre-gate-cut.md`), the one sanctioned turn-end
before it — and the tail that is emptied before `followup` rather than worked through after it. **It binds
only after the first edit** — which is why it left the entry read for the point of use (§1, "Five
documents are read at the point of use", joshuafolkken/kit#1873). `background-commands.md` is the
single source; `followup.md`, `eval-gate.md`, `chain-rule.md` and `epicrun.md` → "Progress while the
run is quiet" route to it, and the run-tail guard (`prompts/collaboration-workflow/rule-delivery.md`)
refuses a foreground push and names it.

**A parent waiting on its children is this same rule at the batch's scale.** A background command's
completion is what re-invokes the session, so a parent with children in flight already has a wake
delivered to it and never has to time one — which is why the `epicrun` / `backlogrun` loop starts no
sleep of its own and reads its polling figures as floors on a re-ask rather than as a clock to keep
(`epicrun.md` → "The parent keeps no clock of its own", the single source, joshuafolkken/kit#1836).
The same measurement settles a merge event at one parent turn rather than three, by the criterion
this rule already applies: the calls that take no other call's result go out together.

## 2i. An observation worth filing is filed without asking

**A run that judges something worth filing files it, and does not ask.** The three routes in §2d all
cover work that changes what the run does — an upstream defect stops it, a split replaces it, a
prerequisite goes in front of it. **A plain observation changes none of that**: the Issue in hand is
untouched, and what the run holds is a finding it would be a loss to forget. That case had no
procedure at all, so a run reaching it fell back on the most cautious-looking thing available and
handed the judgement to a person (joshuafolkken/kit#1649).

**Handing it over is wrong twice.** Filing into a first-party repository is **Tier A** — reversible,
and `CLAUDE.md` → "Decision autonomy" already settles it; the upstream route and the prerequisite
route both file without confirmation, and there is no reason a lone observation should be the one
filing that needs a person. And it breaks the premise `epicrun` and `backlogrun` run on: nobody is
watching, so a run that stops for an answer has parked itself without saying so — the very outcome
those commands' park-and-continue rule exists to avoid.

- **File it, without asking, the moment you judge it worth filing.** A **first-party** target — its
  owner equal to this session's repository owner, decided by
  `gh api repos/{owner}/{repo} --jq .owner.login` rather than by judgement — is Tier A. **A
  third-party target is Tier C and is never filed** (`CLAUDE.md` → "Third-party repositories are
  Tier C").
- **It carries no `route:` label of its own.** `route:tier-a` means a filing the run is *blocked by*
  — an upstream defect or a prerequisite — and an observation blocks nothing
  (`scripts/git/issue-labels.ts`). Where one of the interrupt tests is met the filing is an interrupt
  and takes `route:interrupt`; otherwise it is an ordinary discretionary filing and takes neither.
- **Both ceilings apply to this route exactly as they do to the other three.** §2d's **10 Issues per
  run** counts this filing too: it is what replaced the removed confirmation, so a route that escaped
  it would be the chain of false positives the ceiling exists to stop. So does the backlog **WIP
  cap** — an observation that does not block the run is *discretionary*, which is the branch the cap
  bites on, so with more than 30 open Issues in the target repository, close one first, and nothing
  honestly closable means do not file (`prompts/collaboration-workflow/wip-cap.md`).
- **Run `pnpm josh issue:scout "<title>"` before the `gh api … issues` call**, as before any other
  filing (§2e, joshuafolkken/kit#1679). This route reaches the filing call without a `new` entry
  point in front of it, which is how it used to skip the one check that catches a duplicate.
- **Run `pnpm josh epic:bundle <new>` on what was filed**, as after any other filing. An Issue no epic
  tracks is one `epic:next` never offers, so an unbundled observation is parked rather than recorded.
  **Where that epic's root carries `auto-ok` the filing joins the backlog's pool**, which is admitted
  and bounded rather than denied: `.claude/skills/workflow-commands/backlogrun.md` → "What one
  invocation approves" is the single source of how this obligation and that authorization boundary
  meet (joshuafolkken/kit#1675).
- **The run continues.** Nothing is stashed, nothing is parked, no Telegram is sent, and the Issue in
  hand is implemented as it was. Name what was filed in the completion report.

**What stays a judgement is whether it is worth filing, not whether to ask.** An observation nobody
would act on is not filed at all — dropping it costs nothing, and the WIP cap is what makes dropping
the default at the margin. What this section removes is only the confirmation stop between deciding
to file and filing. **The two mechanisms below take most of that judgement back out**, because left
whole it resolved one way every time.

**The procedure is `observation-filing.md`, and it is read the moment you judge something worth
filing — in full, in the same turn, before the `gh api … issues` call** (joshuafolkken/kit#1797). It
carries the depth test and its table, the depth labels and their provisioning commands, the depth-0
share, the ledger's five-field grammar and its commit path, the promotion on a second sighting, and
what a delegated child does instead. **It is not "read it later"**: nothing here is summarized and
nothing is deferred past the call it governs — what changed is only that a run which never finds an
observation never pays for it, which is the entry cost joshuafolkken/kit#1797 measured. The four
things above are the rule; that file is how each one is carried out, and it is the single source of
every one of them.

This section is the single source of the rule; nothing under `prompts/collaboration-workflow/`
restates it (joshuafolkken/kit#1649).

## 3. What stays resident, and what is read from here

**The first question is whether the rule's trigger can be named** (joshuafolkken/kit#1524):

> **Can the moment the rule begins to bind be named as one tool call?**

**A rule whose trigger can be named moves its body out of `CLAUDE.md`.** It goes on the enumeration
in `prompts/collaboration-workflow/rule-delivery.md`, and a hook refuses that call and states the
rule — cheaper than resident prose, because it costs nothing on every other turn, and **stronger,
because a refusal cannot be skimmed past**. joshuafolkken/kit#1344 and joshuafolkken/kit#1460 each
measured a rule that was resident and never fired once; in both, a `PreToolUse` refusal was what
moved the number. **Relocating is not deleting** — the rule's text survives, on a stronger channel,
which is why it does not wait on joshuafolkken/kit#1477's measurement of what reading a rule costs.

**What stays behind is the trigger and the criterion, one line, because the channel reaches one
harness.** `CLAUDE.md` is agent-agnostic by construction — `AGENTS.md`, `GEMINI.md` and
`.cursorrules` are pointers to it, and a Codex, Gemini or Cursor session runs no
`.claude/settings.json` hook at all; so does a Claude Code session with the guard's own off-switch
set. Removing the line outright would leave those sessions with no statement of the rule anywhere,
which is the deletion this Issue's own premise forbids. **The gain is the body, not the line**: the
measurement, the rejected mechanisms and the procedure leave, and what remains is what the residency
doctrine already calls a resident rule — a trigger plus a pointer. A rule may leave residency
entirely only where the agent that has to obey it is always this harness.

Only a rule whose trigger cannot be named reaches the second question:

**A rule stays in `CLAUDE.md` if and only if it has to fire on a turn where no skill was loaded.**
That test has exactly one input: when does the rule first bind — before a
command has started, or after. Everything a run reaches only *after* it has read this skill is
routed to from `CLAUDE.md`, never restated there.

`CLAUDE.md` is the only document this section is about. `AGENTS.md` and `GEMINI.md` hold no rules at
all since joshuafolkken/kit#963 — they are pointers to it, so nothing can be resident in them.

**How much of a resident rule is resident is `rule-residency.md`, and it is read when a rule is
actually being placed, moved or retired** (joshuafolkken/kit#1797). The two questions above decide
*whether*; that file decides *how much*, and carries the trigger-plus-pointer shape a resident rule
takes, the enumeration of every resident rule that has an on-demand counterpart, the retirement route
and its three tests, and the readings of `pnpm josh rule:value` that have refused every candidate so
far. **No run reaches it** — the moment it binds is a turn spent editing these documents, never a
turn spent executing an Issue — which is why leaving it there costs a workflow entry nothing. It is
the single source of everything it carries.

