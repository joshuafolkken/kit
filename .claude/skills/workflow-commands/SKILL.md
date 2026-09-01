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
`eval-gate.md` is read from the verification gate below, by whichever command reached it.

| Typed keyword                            | Read                                        |
| ---------------------------------------- | ------------------------------------------- |
| `kickoff` / `kickoff #N` / `kickoff new` | `kickoff.md` + `split-assessment.md`        |
| `fullrun` / `fullrun #N` / `fullrun new` | `fullrun.md` + `split-assessment.md` + `chain-rule.md` + `followup.md` |
| `halfrun` / `halfrun #N` / `halfrun new` | `halfrun.md` + `split-assessment.md`        |
| `queue #N1 #N2 …`                        | `queue.md` + `fullrun.md` + `chain-rule.md` + `followup.md` |
| `epicrun #E`                             | `epicrun.md` + `split-assessment.md` + `fullrun.md` + `chain-rule.md` + `followup.md` |

## 2. What every one of them shares

- **The verification gate**, in this order: refactor per `prompts/refactoring.md` → `pnpm josh gate` (lint, type check, spell check and unit tests, run concurrently) → `/code-review` at the level `pnpm josh review:level` prints
  on `git diff main`, iterating until no high/medium findings remain — **at most two reviews in total**
  (`prompts/review.md` → "Review round cap") → `pnpm josh eval:scope`, and `pnpm josh eval` when it
  answers `required` (`eval-gate.md`). `kickoff` is the exception —
  it never implements, so it never reaches the gate.
  **The rule-compliance measurement is read after the review and before the commit, never inside
  `pnpm josh gate`**: the gate repeats every fix round and every child, and one `josh eval` is five
  real Claude sessions. **It is *started* when the review starts, because neither writes to the
  working tree**, and `pnpm josh eval:scope --since-eval` afterwards says whether the review moved a
  measured path and the run has to be repeated (joshuafolkken/kit#1152) — a stale result is never
  reported. Its last line is the verdict — `blocked` stops the merge, `unmeasured` does
  not but is reported, and a run nobody saw hold is never reported as green. `eval-gate.md` carries
  the trigger set, the cost ceiling, and why an epic's completion does not run it a second time.
  **E2E closes after that, and never by asking the user**: where the command ends in a pull request
  (`fullrun` / `queue` / `epicrun`) the CI E2E job is the result and `pnpm josh followup --merge`
  is what enforces it; where it does not (`halfrun`), you run `pnpm josh test:e2e` yourself before
  the stop. `CLAUDE.md` → "Completion gate" carries the rule, `prompts/testing-guide.md` → "Closing
  the E2E gate without a human run" the procedure.
- **A child carrying `needs-human-review` stops the run before its commit**, at every entry point —
  §2z. It is the one *child's* stop `epicrun` does not turn into a park — an `epic:audit` error and
  the consecutive-failure abort end a run too, but neither is a child asking for something.
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

## 2z. `needs-human-review` — the child that stops before its commit

An issue carrying **`needs-human-review`** is degraded to a `halfrun`-shaped stop, whichever entry
point reached it — `epicrun`, `fullrun` or `queue` (joshuafolkken/kit#1125). It is `auto-ok`'s
opposite: that label widens unattended execution past an epic's edge, this one withholds its last
step, and both may be applied **only by a person**.

- **Implementation and the verification gate run normally** — refactor, `pnpm josh gate`,
  `/code-review`, `pnpm josh eval:scope`, exactly as for any other child.
- **Run `pnpm josh test:e2e` yourself before stopping.** With no pull request there is no CI E2E job,
  and `pnpm josh followup --merge` — the thing that blocks a merge on it — is never reached. This is
  `halfrun`'s situation exactly, and `CLAUDE.md` → "Completion gate" gives it the same answer: where
  no pull request is open, you run it and read what it prints. A printed skip is the answer for a
  project with no E2E suite; a skip nobody saw printed is not.
- **Nothing is committed, pushed, opened as a pull request or merged.** `pnpm josh bump`,
  `pnpm josh git` and `pnpm josh followup` are never reached.
- **The working tree is left uncommitted, and nothing is stashed.**
- **Send a `confirmation` Telegram and stop the whole run.** The remaining children are not started —
  inside an `epicrun` this is the one thing that is *not* park-and-continue.
- The Telegram body carries the **resume command**, in the same form `halfrun`'s own stop uses.

**Stopping is the specification, not a failure.** The label's job is not to keep a batch moving; it
is to stop a batch walking past a decision that was a person's to make.

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
everything else is a proposal, written as an Issue comment and left for the person.

**It is not `needs-decision`, and reading it as one breaks two things.** `needs-decision` withholds a
run's *start*; this withholds its *end*. So a `needs-human-review` issue is still offered — excluded,
the artifact a person is meant to look at would never be produced — and a child stopped by it **goes
on holding its repository**, because the uncommitted work is still in the checkout. Read as parked
there, the next child would start `git switch main && git pull` on top of it. `issue-labels.ts` and
`epic-busy.ts` encode both halves.

Canonical reference: `prompts/collaboration-workflow/human-review-label.md`.

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

**Ask before delegating any step of a run**, and use what it answers:

```bash
pnpm josh delegate <step>   # → delegate | keep ; the reason on stderr
pnpm josh delegate --list   # the enumeration, and what was rejected and why
```

**Anything not on the list is `keep`.** A step nobody classified must not be delegated because
nobody said it could not be — the default is the rule, not a fallback. Put the other way: a missed
entry costs money, and a wrong `delegate` costs correctness, quietly.

**A step earns its place by naming how a wrong result is caught** — by something that runs in the
parent tier and costs less than redoing the step. "Unlikely to be wrong" is not that. Most candidates
fail here: a notification body, a decision-log comment and a status read all ship their mistakes with
nothing left to disagree with them, which is why `--list` shows them as rejected rather than absent.

**The mechanism is not the unit.** How a thing is delegated — an isolated execution unit, an explicit
brief, a result the parent can verify, a failure that surfaces — is separate from what is delegated.
The units are one step of a run (`gate-fix`, `survey`) and one whole child of a batch (`epic-child`,
joshuafolkken/kit#984) — an epic's child under `epicrun` and one issue of a `queue` alike
(joshuafolkken/kit#1149). **They share one mechanism** — one enumeration, one command, one verifier
requirement; building a second is the clone `CLAUDE.md` prohibits. **A batch entry point that does
not delegate is the defect**, not a variant: `queue` accumulated every issue's history in one context
until it was wired to this same row, and the per-issue procedure is `queue.md` → "Each issue runs in
a delegated unit".

Canonical reference: `prompts/collaboration-workflow/delegation.md`.

## 2c. The `owner/repo#` prefix — which repository the run acts on

Every entry point takes the target repository in front of the Issue reference. Without it the target
is the repository the session runs in, which is why a conclusion reached in one repository could only
be filed into that same one and a person had to say the destination out loud every time
(joshuafolkken/kit#904).

```
kickoff joshuafolkken/kit#412
kickoff kit#new
kickoff kit#new "<title>"
fullrun joshuafolkken/app-kit#12
halfrun kit#412
queue kit#1 kit#2
epicrun joshuafolkken/kit#858
```

- **One definition, every entry point.** `epicrun` already accepted `owner/repo#E`; the other four
  were left behind. The prefix goes where `#N` goes, so no new keyword is added, and `owner/repo#new`
  stands in the same slot as `owner/repo#N`.
- **A short name expands by prefixing the session repository's owner** — `gh api repos/{owner}/{repo}
  --jq .owner.login` — and **never by searching kit#869's map**, which answers where a checkout is
  rather than which repository is meant. A short name therefore satisfies the first-party test (owner
  equality) by construction, and a repository that is not checked out here is still a valid `kickoff`
  target. A name that does not exist fails as `gh` not found: report it, never read it as a near-miss
  for another name.
- **An explicit owner that is not the session's is a third-party target, and it stops the run.** The
  claim above covers short names only; `fullrun <other-owner>/repo#12` names a tracker we do not own,
  and every write there — Issue, comment, PR — is Tier C (`CLAUDE.md` → "Third-party repositories are
  Tier C"). Typing the prefix is not the explicit instruction that rule requires. **Send a
  `confirmation` Telegram and stop — that is the whole action here**: nothing has been produced yet,
  so there is no finding to record under `## Upstream candidate` and no draft to prepare; that
  procedure belongs to an upstream defect found mid-run. Being able to pass `-R` is not
  authorization.
- **No prefix leaves the behavior exactly as it was** — the target is the session's repository.
- **`kickoff` needs no checkout**: name the target repository in the path of every `gh api` call,
  reads included — a read left on `repos/{owner}/{repo}` silently plans against this repository's issue of
  that number — and never clone. The one exception is the split path's epic, since `pnpm josh epic`
  only writes the repository it runs in — run it in that repository's checkout, or fall back to
  `gh api repos/<owner/repo>/labels …` followed by
  `gh api repos/<owner/repo>/issues -f title="<epic-title>" -f 'labels[]=epic' -f body="<body>"`, and report that `epic:check` could not
  be run. **The promote arm has no such fallback**: `--promote` writes
  only its own repository too, and creating an epic instead would leave `#N` neither promoted nor
  tracked, so with no checkout there, file the children and stop.
- **The implementing entries require a checkout and never create one — when the target is another
  repository.** A prefix naming the session's own repository changes nothing: `fullrun kit#412` in
  the kit checkout behaves exactly as `fullrun #412`, stash step included. Otherwise resolve the
  checkout from `pnpm josh doctor`; **no checkout there, or a tree that is not clean, stops the run**
  with a `confirmation` Telegram — cloning decides the layout of someone's machine for them, and a
  dirty tree holds work that is not yours to stash (each entry's own "stash what is in the tree" step
  covers the session's repository, never someone else's checkout). Otherwise the commands that act
  on the target, from `git switch main && git pull` to `pnpm josh followup --merge`, execute in that
  checkout — **a command naming a different repository still runs where that repository is**, which
  is why a cross-repository `into` insertion runs in the epic's checkout (§2a).
- **`epicrun` is exempt from the whole bullet above**: `owner/repo#E` names where the *epic* lives,
  not where its children are implemented. Its state is read against that repository through
  `gh api`, so that repository needs no checkout and a missing or dirty one never stops the launch.
  The checkout rules bind each child at implementation time, against **that child's** repository,
  and which session runs which child stays "Concurrency" in `epicrun.md` — one session per
  repository.
- **Independent of `into <target>`**: this says which repository the run acts on, `into` says which
  epic the artifact joins, and both may need qualifying in one line.

Canonical reference: `prompts/collaboration-workflow/target-repo.md`.

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
`scripts/verify-ui-skill.test.ts` for the UI gate,
`scripts/review-followup-bundle-document-rule.test.ts` for the follow-up filing step, and
`scripts/inline-edit-rule.test.ts` for the file-editing prohibition:

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
- **The rule-compliance measurement's trigger** — `pnpm josh eval:scope`, and `pnpm josh eval` when
  it answers `required`. A change to a distributed document is reported finished on turns that typed
  no workflow keyword at all — "fix this wording in `CLAUDE.md`" is the common one — so the trigger
  has to be readable there. The procedure it routes to is `eval-gate.md`.
- **The UI-verification gate** — a rendered change is not done until the screen has been looked at,
  and the procedure for capturing it is `verify-ui`. The gate binds whenever a UI change is reported
  finished, which is routinely a turn with no workflow keyword typed and no skill loaded.
- **The three `josh epic:*` rules that bind outside those commands** — recording a decision removes
  that child's `needs-decision` label, fixing what `epic:audit` finds is Tier A, and an epic in
  another repository is referenced as `owner/repo#N`. Each fires on a turn where no `epic:*` command
  was run: the moment an issue is filed, or a decision written. The commands' own procedures are in
  `.claude/skills/epic-commands/`, which is where everything else about them lives.
- **The prohibition on carrying a file's new text inside a shell command** — an edit happens on any
  turn at all, and there is no skill that a run loads *before* editing. Placed on demand, this one
  rule would never fire once, which reads exactly like having deleted it. The measured cost, the
  allowed/prohibited table and the reasoning are at
  `prompts/collaboration-workflow/file-edits.md`; what stays resident is the instruction and the
  criterion that decides it — whether the command carries the replacement wholesale, not which tool
  was used (joshuafolkken/kit#1150).

These do not pass it, and live in a skill instead: the split assessment (`split-assessment.md`), a
prerequisite discovered mid-run (`fullrun.md` / `halfrun.md` / `epicrun.md`), `epicrun`'s acceptance
of an Issue that is not an epic and its park-and-continue behavior (`epicrun.md`), the whole
verification gate and merge chain (`chain-rule.md` / `followup.md`), and the post-update verification
procedure (`.claude/skills/dependency-update/`) that the two prohibitions above route to.

The `auto-ok` pickup and its "only a person applies the label" rule (`epicrun.md`) are the borderline
case worth naming, because a prohibition on writing usually *is* resident. It is not, and the reason
is that `auto-ok` exists nowhere but the documents that also forbid an agent applying it: a turn that
opens none of them is a turn on which the label is never reached, so residency would buy nothing.

**The criterion is not advisory.** `scripts/workflow-skills.test.ts` caps each document at
`RESIDENT_CEILING_BYTES` and requires headroom under it, so a procedure restated resident costs
budget that the next genuinely-resident rule then has to take back out of existing prose. When a
rule is edited by deleting a neighboring sentence to keep a byte count, the deletion is chosen by
what was not pinned by a marker rather than by what matters (joshuafolkken/kit#951).
