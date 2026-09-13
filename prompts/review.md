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

- **Pre-commit self-review** (implementing session, inline): before every `git commit` on a feature
  branch — scope: the staged diff (`git diff --staged`), level from
  `pnpm josh review:brief --level-only`.
- **Workflow review step** (same session, inline): the last stage of the verification gate in `fullrun`
  / `halfrun` / `queue`, driven by the brief `pnpm josh review:brief` prints. Round 1 runs before the
  commit — scope: `git diff main`. Round 2 runs after it, beside the CI the commit started
  (`.claude/skills/workflow-commands/chain-rule.md` → "The pull request opens between the rounds, so CI
  runs beside round 2").

Re-run after applying fixes until **no high or medium findings remain — or until two reviews have run
in total, the first included — whichever comes first.** The cap below is not optional. The second round
is a verification pass over the fixes, not the first review again
(`prompts/review-rubric.md` → "The second round is a verification pass, not a second full review").

---

## Review level (decided by `pnpm josh review:brief --level-only`, never by judgement)

**Run `pnpm josh review:brief --level-only` and use what it prints.** It reads the changed paths and
answers `low` or `medium`; `--staged` classifies the staged diff instead of the branch diff, and
`--json` adds the reason. Inside a workflow, `pnpm josh review:brief` prints the same level on its first
line and the rest of the brief with it.

```bash
pnpm josh review:brief --level-only            # the branch diff
pnpm josh review:brief --level-only --staged   # the staged diff
```

**The level is decided from the changed paths and nothing else.** "This one is small" is a judgement
made under cost pressure, and cost pressure resolves it toward "small" exactly when a defect is most
likely to be shipped. A rule an agent applies from memory is a rule an agent can talk itself out of;
one it has to run answers the same way every time.

| Every changed path is…                                                                   | Level    | Rounds                  |
| ---------------------------------------------------------------------------------------- | -------- | ----------------------- |
| **inert** — `.editorconfig`, `.gitignore`, `LICENSE`, `CHANGELOG.md`, `*.code-workspace` | `low`    | 1                       |
| anything else                                                                            | `medium` | up to 2 (the cap below) |

**One non-inert path decides the whole change.** A review reads the change, not a subset of it, so
there is no per-file level. An empty diff also takes `medium` — answering `low` to "nothing changed"
would hand a reduced level to a caller that failed to read the diff.

**Three things that look inert are not.** `.vscode/**`, `.gitattributes` and `.prettierignore` are all
in `package.json`'s `files` and are written into every consumer project by `josh init` / `josh sync`,
so a defect in one reaches a consumer and is reviewed at `medium` like any other shipped file.

**Documentation is not inert either, and that is deliberate.** `CLAUDE.md`, `prompts/**`, `.claude/**`
and `docs/**` are all reviewed at `medium`. The "Non-runtime updates" exception in `CLAUDE.md` exempts
them from _testing_ — which asks whether an automated test could have caught the defect — while this
asks whether a human reading the diff is the only thing that can. Measured on joshuafolkken/kit#963 and
#965, both documentation-only by that classification: a `medium` review found ten real defects in each
— pointers into sections that had been removed, and citations naming the wrong file, in artifacts
distributed to every consumer — that nothing else would have caught.

**A confirmed High blocks regardless of round count**, and the round cap below does not change that.

---

## Review round cap (2 rounds)

The severity rule in the rubric is not a stopping condition on its own. Every fix creates new surface,
and a review whose scope is the whole change finds something in it — so the loop is bounded by how much
new code the fixes produce, which is unbounded.

**Two rounds is the ceiling, not the schedule.** Whether the second one is due at all is
`pnpm josh review:round2`'s answer — "When round 2 is skipped entirely, and when it is not" below is
the single source of that condition (joshuafolkken/kit#1433).

This is measured, not theorized. On joshuafolkken/kit#854 four rounds produced 18 findings; on #855
two rounds produced 19. Almost none of them was a repeat: each round found new things, and many of
those were about code the **previous round's fix** had just written. Two rounds of that is diligence; a
third is the review chasing its own tail.

### A merge-conflict resolution review is not one of the two

**When `pnpm josh followup` reports `PR checks failed (merge conflict)`, the child resolves the conflict
in its own lane and reviews the resolution — and that round does not count against the cap**
(joshuafolkken/kit#1623). The cap bounds re-reading _the change under review_; a resolution review reads
a different subject — not the change, but what merging a moved `main` into it did.
`.claude/skills/workflow-commands/epicrun.md` → "Conflicts are not predicted" is the single source of
the procedure and of the four conditions under which the run steps back instead of resolving.
`pnpm josh review:attest --check` must answer `ok` before the merge is re-issued, and a confirmed High
parks the child rather than buying it a further round.

### When round 2 is skipped entirely, and when it is not

**Two rounds is the ceiling; whether the second round runs at all is a command's answer, not a reading
of a list** (joshuafolkken/kit#1433):

```bash
pnpm josh review:round2 --round-1-closed   # → required | skip ; the reason on stderr
```

**Ask it once round 1's fixes are in and before the commit.** Pass `--round-1-closed` only where every
round-1 High/Medium finding actually closed — by a fix in this working tree, or as a verified false
positive — and none was filed or deferred. **Without the flag the answer is `required`**, which is also
what the command answers to every uncertainty it meets, a missing round-1 snapshot included.

**`skip` has exactly two arms, and both are states in which round 1's fix code needs no review**
(joshuafolkken/kit#1222 — the round exists because round 1's fix code is otherwise unreviewed):

| Arm                    | What it is                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **A — no fix code**    | The fix delta is empty: round 1's findings closed without an edit, so there is no unreviewed fix code                        |
| **B — inert fix code** | Every path in the fix delta is inert by the review-level classification above — neither executing, instructing, nor shipping |

**Neither arm weakens the standard.** A round-1 High/Medium that did not close is not a closed finding,
so the flag is not passable; the cap is still two rounds; and a confirmed High still blocks the merge.
**The wider line joshuafolkken/kit#1433 proposed — exempting anything that is not a runtime code path —
is not adopted**: a documentation-only diff is exactly where the review is the only detector (the #963 /
#965 measurement above), so a prompt fix answers `required`.

**A skipped round is recorded on the Issue**, so the condition stays auditable and can be withdrawn if
a defect is later traced to a skipped delta:

1. Label the Issue `review-round2-skipped`, created once per repository:
   `gh api repos/{owner}/{repo}/labels -f name=review-round2-skipped -f color=c5def5 -f description="Review round 2 was skipped under the condition in prompts/review.md" --silent 2>/dev/null || true`,
   then `gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=review-round2-skipped'`.
2. Post an Issue comment under the heading `## Round 2 skipped`, naming **which arm fired** and quoting
   **the reason line the command printed**, verbatim.

### Three-way disposition after the cap

**After the second round, place every remaining non-High finding in exactly one of three exits, decided
from what the finding is rather than from the filer's discretion** (joshuafolkken/kit#1469). **The
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
   like any other. **"It needs a decision" is no longer a branch-2 condition on its own**: a design
   question with no defect under it takes branch 3.
3. **Drop it with a one-line note in the PR body.** **This is the default, and it takes everything the
   other two branches did not**: a Low that does not reach the user, and every remaining finding that is
   neither closable in place nor a confirmed runtime defect — a design preference or an unproven
   suspicion included. **The note is not optional**: one line naming the finding and why it was dropped
   is what keeps a dropped finding auditable rather than invisible.

**What it costs, and why that is the right trade.** A dropped finding that later turns out to matter is
re-found by the next review of that code, at the price of one round it would have paid anyway. A filed
finding that never mattered is carried forever — placed in an epic, offered by `epic:next`, read by
everyone who scans the backlog. The two errors are not symmetric, and the old default was on the
expensive side of them.

**Findings that reduce to one root judgement are filed as one Issue, not several** — a single follow-up
Issue with a section per symptom (`## 現象 1` / `## 現象 2`).

Only branch 2 files an Issue. What follows applies to that branch.

- **A finding routed to branch 2 is filed as a follow-up Issue referencing the current one, and the
  current Issue completes.** (A confirmed High is not a branch-2 finding: it blocks the merge rather
  than being deferred — see below.)
- **Filing does not end at the Issue.** `epic:next` only ever offers a child the task list of an epic
  names, so an Issue in no epic is never handed to a running `epicrun` — the deferred finding is parked
  forever, which reads the same from the backlog. **The three steps run inside the CI wait, not before
  the commit.** Where the run opens a pull request — `fullrun`, `queue`, `epicrun` — they go after
  `pnpm josh git -y` and before `pnpm josh followup`; where it does not — `halfrun`, or a standalone
  pre-commit self-review — they run as soon as the disposition is decided. **The chain may run in a
  delegated unit** — `pnpm josh delegate followup-filing` (joshuafolkken/kit#1892).

  1. File the follow-up Issue referencing the current one, tagged `route:review-cap`:
     `gh api repos/{owner}/{repo}/issues -f title="<title>" -f 'labels[]=route:review-cap' -f 'labels[]=depth:<n>' -f body="<body referencing the current Issue>"`.
  2. Run `pnpm josh epic:bundle <new>` — **before the current Issue closes.** The candidate search reads
     open issues only, so once the parent has closed the command answers `none` permanently.
  3. Act on its answer. **`epic:bundle` recommends and writes nothing**, so acting means running the
     write command yourself — never a hand edit of the epic body, which leaves the task list and the
     `blocked-by` relations disagreeing and `epic:next` returning `error`.

  | Answer                                                                                            | Do                                                                                                                                                                                                                                                                                                                                | Tier                    |
  | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
  | `add_to_epic`                                                                                     | `pnpm josh epic --add <E> <new>` — add `--before <M>` / `--after <M>` when the relation carries an order                                                                                                                                                                                                                          | **A — no confirmation** |
  | `create_epic`                                                                                     | `pnpm josh epic "<title>" <new> <other> [--ordered]`                                                                                                                                                                                                                                                                              | **A — no confirmation** |
  | `ask` — candidates spread across two or more epics                                                | **Choose the epic you recommend, run its write command, and record the decision** — what was taken, what was rejected, why — on both the new Issue and that epic's `## Decisions`. This does not stop a run and does not park a child (joshuafolkken/kit#1339); stop only where the two epics are genuinely too close to separate | **A — no confirmation** |
  | `none`                                                                                            | Nothing                                                                                                                                                                                                                                                                                                                           | —                       |
  | **The command could not answer** — non-zero exit, or **any** ⚠ warning above `Nothing to bundle.` | Stop and report, naming what it said. **A `none` printed after such a warning is not "nothing to bundle"** — the search was incomplete                                                                                                                                                                                            | —                       |

- **A confirmed High is never deferred.** A real defect does not ship because a round counter ran out,
  so a standing High blocks the merge — never fixed-in-place, filed, or dropped as one of the three
  exits. If a High is still standing after the second round, do not start a third: stop, send a
  `confirmation` Telegram, and put the scope back to the user, where splitting the Issue is usually the
  answer.
