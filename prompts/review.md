# Code Review Prompt

This document is the review **policy**: which level a change is reviewed at, how many rounds a review
runs, and what happens to a finding after the cap. Two other documents hold the rest, and this file
points to them rather than restating them:

- The **rubric** the reviewer applies — the severity tests, the nine categories, the output format and
  the stop conditions — is `prompts/review-rubric.md`, handed to `/code-review` by
  `pnpm josh review:brief`.
- The **orchestration** around a review — how the gate runs beside it, when the pull request opens, how
  the merge is issued — is `.claude/skills/workflow-commands/chain-rule.md` → "Orchestration facts
  single-sourced here".

---

## When to run

When a review runs is `CLAUDE.md` → "Pre-commit Self-Review"; inside a workflow, round 1 runs before
the commit and round 2 beside CI (`.claude/skills/workflow-commands/chain-rule.md`). Pass the
`reviewer` profile's model and effort that `pnpm josh review:brief` prints to the review subagent;
do not substitute the review level for effort.

Re-run after applying fixes until **no high or medium findings remain — or until the round cap below is
reached, the first review included — whichever comes first.** The cap below is not optional. The second round
is a verification pass over the fixes, not the first review again
(`prompts/review-rubric.md` → "The second round is a verification pass, not a second full review").

---

## Review level (decided by `pnpm josh review:brief --level-only`, never by judgement)

**Run `pnpm josh review:brief --level-only` and use what it prints** — `low` or `medium`, from the
changed paths and nothing else, never "this one is small". `--staged` classifies the staged diff,
`--json` adds the reason; inside a workflow `pnpm josh review:brief` prints the same level on its first
line. A `low` change gets 1 round, a `medium` one up to 2 (the cap below). How the answer is derived —
the inert paths, documentation at `medium`: `docs/maintainers/review-history.md` → "The level is
decided from the changed paths".

```bash
pnpm josh review:brief --level-only            # the branch diff
pnpm josh review:brief --level-only --staged   # the staged diff
```

**A confirmed High blocks regardless of round count**, and the round cap below does not change that.

---

## Review round cap (2 rounds)

The severity rule in the rubric is not a stopping condition on its own: every fix creates new surface a
further round would find something in.

**Two rounds is the ceiling, not the schedule.** Whether the second one is due at all is
`pnpm josh review:round2`'s answer — "When round 2 is skipped entirely, and when it is not" below is
the single source of that condition.

### A merge-conflict resolution review is not one of the two

**When `pnpm josh followup` reports `PR checks failed (merge conflict)`, the child resolves the conflict
in its own lane and reviews the resolution — and that round does not count against the cap**. The cap bounds re-reading _the change under review_; a resolution review reads
a different subject — not the change, but what merging a moved `main` into it did.
`.claude/skills/workflow-commands/backlogrun-recovery.md` → "Conflicts are not predicted" is the single source of
the procedure and of the four conditions under which the run steps back instead of resolving.
`pnpm josh review:attest --check` must answer `ok` before the merge is re-issued, and a confirmed High
parks the child rather than buying it a further round.

### When round 2 is skipped entirely, and when it is not

**Two rounds is the ceiling; whether the second round runs at all is a command's answer, not a reading
of a list**:

```bash
pnpm josh review:round2 --round-1-closed   # → required | skip ; the reason on stderr
```

**Ask it once round 1's fixes are in and before the commit.** Pass `--round-1-closed` only where every
round-1 High/Medium finding actually closed — by a fix in this working tree, or as a verified false
positive — and none was filed or deferred. **Without the flag the answer is `required`**, which is also
what the command answers to every uncertainty it meets, a missing round-1 snapshot included.

**`skip` has exactly two arms** — **A** (no fix code: the fix delta is empty) and **B** (inert fix
code: every path in the fix delta is inert by the review-level classification above); the reason line
names which fired. Why neither weakens the standard: `docs/maintainers/review-history.md` → "The two
skip arms".

**A skipped round is recorded on the Issue**, so the condition stays auditable and can be withdrawn if
a defect is later traced to a skipped delta:

1. Label the Issue `review-round2-skipped`, created once per repository:
   `gh api repos/{owner}/{repo}/labels -f name=review-round2-skipped -f color=c5def5 -f description="Review round 2 was skipped under the condition in prompts/review.md" --silent 2>/dev/null || true`,
   then `gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=review-round2-skipped'`.
2. Post an Issue comment under the heading `## Round 2 skipped`, naming **which arm fired** and quoting
   **the reason line the command printed**, verbatim.

### Three-way disposition after the cap

**After the second round, place every remaining non-High finding in exactly one of three exits, decided
from what the finding is rather than from the filer's discretion**. **The
default exit is branch 3, and branch 2 has to be earned**. Read them in order — branch 1 where the fix is
trivial and local, branch 2 only where the finding clears the bar it names, branch 3 for everything
left, which is most of them. "It might matter later" is branch 3.

1. **Fix it in place.** The finding closes in a few lines inside a file the diff already touches, with
   no design judgement — a stale comment, a name, an unused export. **A fix-in-place never starts a new
   review round**: the fix widens the diff, so a naive re-review would re-open the loop the cap just
   closed. The fix must stay **inside a file the diff already changed** and carry **no design decision**;
   a finding that cannot close under both limits is filed, not fixed in place.
2. **File it as an Issue.** The finding is a **confirmed defect that reaches a runtime code path** —
   both halves, and neither on its own. Confirmed means the failure scenario is stated in concrete
   inputs and state. **Reaching is read exactly as the rubric's Severity test 1 reads it** — a runtime
   code path, a distributed artifact a consumer reads, or the verification that guards either — so in a
   repository whose product is its distributed documents, a defect in one of those is a branch-2 finding
   like any other. **The reaching half is not a judgement**: `pnpm josh disposition <path>` answers
   `runtime` / `non-runtime` from the finding's paths, sharing the same inert set the review level uses,
   so only "is the defect confirmed" is left to decide. **"It needs a decision" is no longer a branch-2
   condition on its own**: a design question with no defect under it takes branch 3.
3. **Drop it with a one-line note in the PR body.** **This is the default, and it takes everything the
   other two branches did not**: a Low that does not reach the user, and every remaining finding that is
   neither closable in place nor a confirmed runtime defect — a design preference or an unproven
   suspicion included. **The note is not optional**: one line naming the finding and why it was dropped
   is what keeps a dropped finding auditable rather than invisible.

**Findings that reduce to one root judgement are filed as one Issue, not several** — a single follow-up
Issue with a section per symptom (`## 現象 1` / `## 現象 2`).

Only branch 2 files an Issue. What follows applies to that branch.

- **A finding routed to branch 2 is filed as a follow-up Issue referencing the current one, and the
  current Issue completes.** (A confirmed High is not a branch-2 finding: it blocks the merge rather
  than being deferred — see below.)
- **Filing does not end at the Issue.** `epic:next` only ever offers a child the task list of an epic
  names, so an Issue in no epic is never handed to a running `backlogrun` — the deferred finding is parked
  forever, which reads the same from the backlog. **The steps run inside the CI wait, not before
  the commit.** Where the run opens a pull request — `fullrun`, `backlogrun` — they go after
  `pnpm josh git -y` and before `pnpm josh followup`; where it does not — `halfrun`, or a standalone
  pre-commit self-review — they run as soon as the disposition is decided. **The chain may run in a
  delegated unit** — `pnpm josh delegate followup-filing`.
- **A second follow-up from one round folds into the first by default.** Several findings from one
  review fold into one Issue — the filing-time counterpart to the split assessment, reading the same
  two questions (`.claude/skills/workflow-commands/split-assessment.md` → "The same two questions
  decide the filing-time fold"). `pnpm josh issue:file` asks the fold question itself on the run's
  second filing and holds a `fold`; the first filing asks nothing.

  1. File the follow-up Issue referencing the current one, tagged `route:review-cap` — **before the current Issue closes.**
     `pnpm josh issue:file "<title>" --body-file <body-file> --depth <n> --route review-cap`.
     The command lints the body, applies the classification labels it declares, runs the duplicate scan
     and then `epic:bundle` on the new Issue (`docs/josh-commands-backlog.md` → `josh issue:file`). The
     `epic:bundle` candidate search reads open issues only, so once the parent has closed it answers
     `none` permanently.
  2. Act on the `epic:bundle` answer it prints. **`epic:bundle` recommends and writes nothing**, so acting means running the
     write command yourself — never a hand edit of the epic body, which leaves the task list and the
     `blocked-by` relations disagreeing and `epic:next` returning `error`.

  | Answer                                                                                            | Do                                                                                                                                                                                                                                                                                                       | Tier                    |
  | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
  | `add_to_epic`                                                                                     | `pnpm josh epic --add <E> <new>` — add `--before <M>` / `--after <M>` when the relation carries an order                                                                                                                                                                                                 | **A — no confirmation** |
  | `create_epic`                                                                                     | `pnpm josh epic "<title>" <new> <other> [--ordered]`                                                                                                                                                                                                                                                     | **A — no confirmation** |
  | `ask` — candidates spread across two or more epics                                                | **Choose the epic you recommend, run its write command, and record the decision** — what was taken, what was rejected, why — on both the new Issue and that epic's `## Decisions`. This does not stop a run and does not park a child; stop only where the two epics are genuinely too close to separate | **A — no confirmation** |
  | `none`                                                                                            | Nothing                                                                                                                                                                                                                                                                                                  | —                       |
  | **The command could not answer** — non-zero exit, or **any** ⚠ warning above `Nothing to bundle.` | Stop and report, naming what it said. **A `none` printed after such a warning is not "nothing to bundle"** — the search was incomplete                                                                                                                                                                   | —                       |

- **A confirmed High is never deferred.** A real defect does not ship because a round counter ran out,
  so a standing High blocks the merge — never fixed-in-place, filed, or dropped as one of the three
  exits. If a High is still standing after the second round, do not start a third: stop, send a
  `confirmation` Telegram, and put the scope back to the user, where splitting the Issue is usually the
  answer.
