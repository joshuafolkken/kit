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
| `chain-rule.md` → "Run the review-to-merge chain" | Before running the `/code-review` step (`fullrun` / `backlogrun`) |
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
| First call of `fullrun` / `halfrun` (not `kickoff`) | Claim the tree: `pnpm josh run:hold`, ahead of the split assessment and a `new` entry's filing | §2f → `working-tree-hold.md` |
| Same turn as the hold (not a dispatched child, not `kickoff`) | `pnpm josh cost --cut`; `under` continues, `over` stops with a `confirmation` Telegram and the resume command, then `pnpm josh run:release` | `backlogrun-progress.md` → "The hand-off" (shared 200,000 threshold) |
| Before any work starts (every entry) | The split assessment; the default is not to split — separability **and** a scope clearly over one gate must hold together; a `fullrun` / `halfrun` that finds a split files the epic and **stops** | `split-assessment.md` → "The question" |
| Another Issue here must land first | A prerequisite is a dependency, not a park (the third of four mid-run discoveries) | §2d → `prerequisite.md` |
| Something worth filing, none of the three | File it without asking (Tier A, first-party) and carry on; a delegated child returns it to the parent instead | §2i → `observation-filing.md` |
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
delegated unit", which `backlogrun-steps.md` → "Named issues run first, in order" applies to a named issue.

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
unit", which `backlogrun-steps.md` → "Named issues run first, in order" applies to a named issue. The
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
- **Every filing route runs it, not only a `new` entry point, and `pnpm josh rule:guard` refuses a
  filing the run has not scouted** (`prompts/collaboration-workflow/rule-delivery.md`) — the trigger is
  the `gh api … issues` call, never which keyword started the run, so §2d's prerequisite, §2i's
  observation and the review round cap's branch-2 filing all go through it.
- **A `#N` entry point does not run it *for the Issue it was handed*.** `fullrun #N` / `halfrun #N` /
  `kickoff #N` are given an Issue that already exists. That says nothing about an Issue such a run goes
  on to file later, which the bullet above covers.
- **The split path files each child through the same step.** The epic itself is not scouted: it is
  created over children that were, and `epic:bundle` places it afterwards.

Full behavior, the thresholds and why the duplicate half compares titles rather than bodies:
`docs/josh-commands.md` → "`josh issue:scout`".

## 2f. The working-tree hold — one run per tree

**Trigger:** the first call of `fullrun` and `halfrun` alike — before the title is normalized, before
`git switch main`, and before a `new` entry files its Issue. **Then:** `pnpm josh run:hold [<N>]`
claims the tree; `hold` continues, `busy` and `unknown` both stop with a `confirmation` Telegram
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

**A run that judges something worth filing files it, and does not ask.** The three routes in §2d all
cover work that changes what the run does — an upstream defect stops it, a split replaces it, a
prerequisite goes in front of it. **A plain observation changes none of that**: the Issue in hand is
untouched, and what the run holds is a finding it would be a loss to forget. Handing it over is wrong
twice: filing into a first-party repository is **Tier A** and already settled, and stopping for an
answer under `backlogrun` parks the run without saying so.

- **File it, without asking, the moment you judge it worth filing.** A **first-party** target — its
  owner equal to this session's repository owner, decided by `pnpm josh repo:party` rather than by
  judgement — is Tier A. **A third-party target is Tier C and is never
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
- **When this is the run's second filing, run `pnpm josh issue:fold` first.** Several findings from one
  session fold into one Issue by default — the filing-time counterpart to the split assessment, reading
  the same two questions (`split-assessment.md` → "The same two questions decide the filing-time fold").
  `pnpm josh rule:guard` refuses the second `gh api … issues` call until it is folded; the first filing
  asks nothing.
- **Run `pnpm josh epic:bundle <new>` on what was filed**, as after any other filing. An Issue no epic
  tracks is one `epic:next` never offers. **Where that epic's root carries `auto-ok` the filing joins
  the backlog's pool** (`backlogrun-steps.md` → "What one invocation approves").
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

**The residency criterion and its procedure are `rule-residency.md`, read only when a rule is being
placed, moved or retired — never at any entry, and never during a run.** It carries question 0 (is the
answer computable from mechanically readable inputs, so it is a decision oracle — `pnpm josh
oracle:list`), the first question (can the trigger be named as one tool call, so the body moves out of
`CLAUDE.md` to a hook via `prompts/collaboration-workflow/rule-delivery.md`), the second question
(does it have to fire on a turn where no skill was loaded, so it stays in `CLAUDE.md`), and the
procedure that decides how much of a resident rule is resident — the trigger-plus-pointer shape, the
enumeration of every resident rule with an on-demand counterpart, and the retirement route and its
three tests. `rule-residency.md` is the single source; the moment it binds is a turn spent editing
these documents, never a turn spent executing an Issue.
