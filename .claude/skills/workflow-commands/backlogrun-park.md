# `backlogrun` — a child that cannot finish

**Read this file in full when a child cannot finish** — before parking it, before a
`needs-human-review` stop, or before recording a mid-run prerequisite or split.

## What happens to a child that cannot finish

A `backlogrun` child is a `fullrun` under a batch authorization:

- **A stop that would end the run parks one issue and the run continues** — → "park and continue".
- **A prerequisite discovered mid-run is recorded as a dependency rather than parked** — → "A
  prerequisite discovered mid-run"; `prerequisite.md` separates prerequisite, split and upstream
  defect. With no epic, the `blocked-by` is written on the issue itself.
- **A split found mid-run** files the children and the epic and does not stop the batch —
  `split-assessment.md`, → "Splitting a child mid-run". Not a park, not a failure.
- **`in-progress` left behind by an interrupted run** — → "`in-progress` is removed by whoever finds
  it stale".
- **A child released from `needs-decision` is re-dispatched to a lane, never implemented by the
  parent** — `backlogrun.md` → "Claim nothing at the entry — this parent orchestrates and never
  implements".

## The parent does not investigate a lane failure itself

**A lane failure whose reason is not on its Issue is read by a unit** — `pnpm josh delegate
lane-failure-investigation`; the parent checks the cited lines and `pnpm josh issue:state` before it
parks, re-dispatches or files.

## `needs-human-review` — the one stop that is not a park

A child carrying **`needs-human-review`** stops `halfrun`-shaped and **the whole run ends there**:
implementation and the gate run, nothing is committed, the tree is left dirty and unstashed, a
`confirmation` Telegram carries the resume command, and the remaining children are not started.

**The child goes on holding its repository**, and **its lane is left open and untouched**. **Name the
lane directory in the stop report and in the Telegram.** Lanes in flight finish; no new lane opens.

**Never apply or remove the label** — a person's alone (`needs-human-review.md`, the single source).

## park and continue

When a child hits something only a person can decide (→ "Only a person's judgement carries
`needs-decision`"), **park the child and keep going**:

```bash
gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=needs-decision'
pnpm josh issue:comment <N> --body-file <path>   # what needs deciding, and the options
```

`in-progress` stays; the parked child does **not** hold the repository (`needs-decision` takes
precedence in `epic:next`). Return to step 1.

**A parked child's lane is kept, whether or not it had committed**, and every parked ending owes
`pnpm josh run:release <N>` — `backlogrun-lanes.md` → "What happens to a lane". A lost merge race
resolves in its lane instead (`backlogrun-recovery.md` → "Conflicts are not predicted").

**Parking replaces stopping the session, not the rule that produced the stop** — an upstream defect is
still filed at once, and a workaround is still forbidden. `epic:bundle`'s `ask` is Tier A, not a park:
`pnpm josh epic --add <E> <N> --after <M>` and record it on both Issues' `## Decisions`.

**Removing the label is Tier A — do it without asking**, once the decision is recorded:

```bash
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/needs-decision 2>/dev/null || true
```

**The released child goes back to a lane, never into the parent's own context** — `pnpm josh
lane:launch <N>`.

## Only a person's judgement carries `needs-decision`

**`needs-decision` means "a person has to choose", and nothing else.** It carries only:

- a design choice nobody has made;
- a Tier B toss-up, or a Tier C action (`CLAUDE.md` → "Decision autonomy");
- an upstream defect in another package, whose wait-or-defer is the person's (`upstream-interrupt.md`).

It never carries:

- a choice with a clearly better default — that is Tier A: decide it and record it as an Issue comment;
- whether to run something already planned and opted in with `auto-ok` — the opt-in is that decision;
- a wait for the next published release — a dependency, `pnpm josh issue:release <N> --wait`
  (`prerequisite.md`);
- a defect in the running repository's own run tooling — the run fixes it and resumes
  (`prompts/collaboration-workflow/upstream-interrupt.md` → "実行中のリポジトリ自身のラン機構の不具合");
- a wait on an open blocker or a start date — `run:merge` releases it (`run-merge-steps.ts`);
- a mechanical failure — the driver applies `run:stalled` (`RUN_STALLED_LABEL` in `issue-labels.ts`).

**When in doubt, it is Tier A**: decide, comment the decision, and continue. **A label a mechanical step
applied** (a failed or abandoned child, a lost merge race) is read against this list once its reason is
known, and removed when the reason is not on it.

## `in-progress` is removed by whoever finds it stale

An interrupted run leaves `in-progress` behind, which excludes the child from `epic:next` permanently
and occupies a lane. **A session that detects a stale child removes the label itself** (Tier A) and
reports it, before continuing. **The rule therefore applies to any open issue in the repository, not
only to this epic's children** (`epic:next` names the holders on standard error).

**Age alone is not the test.** Past the 90-minute window, check what holds it: a `halfrun` stopped for
manual verification, a run paused mid-child, and a `needs-human-review` child hold it legitimately.
**All three leave uncommitted work in the checkout**, so `git status` there decides: a dirty tree means
the hold is real — leave the label and report.

**A closed issue's labels are neither a finding nor something to clean up** (no lane, never offered).
**Do not report it, and do not strip it.**

```bash
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true
```

## A prerequisite discovered mid-run

Something else in **this** repository has to land first: not a split, not an upstream defect.
`prerequisite.md` is the single source of the distinction, the `route:tier-a` filing and the ceiling.
`<M>` is the child in hand; `<N>` the new Issue.

1. File the prerequisite `<N>` with `route:tier-a` (Tier A, first-party, no confirmation) — **first**,
   because the next step names it.
2. **Stash the work in progress**:

   ```bash
   git stash push -u -m "backlogrun: paused #<M> for prerequisite #<N>"
   pnpm josh issue:comment <M> --body-file <path>   # what was stashed, and that #<N> must land first
   ```

   **`-u` is not optional** (new test files are untracked). **Pop it by message, never by position** —
   `pnpm josh stash:pop "backlogrun: paused #<M> for prerequisite #<N>"` — when `epic:next` offers `<M>`
   again, after its `pnpm josh ms`; expect conflicts.
3. `pnpm josh epic --add <E> <N> --before <M>` — row, declaration and `blocked-by` in one command;
   never a hand edit. **With no epic**, record `<M>` blocked by `<N>` alone with the `gh api
   …/dependencies/blocked_by` call in
   `prompts/collaboration-workflow/issue-template.md` → "複数 Issue に分割するときの epic Issue", step 4.
4. **Remove `in-progress` from `<M>`** — `pnpm josh run:release <M>`; a labelled child is never offered again.
5. **Do not park.** Back to step 1 of the loop; `epic:next` hands back the prerequisite first.

**A stop a dependency can express is never parked**, including a defect in this repository's own gate
or run tooling — `prerequisite.md`.

## Splitting a child mid-run

Not a reason to stop. File the new children with `route:split` (Tier A, first-party), then
`pnpm josh epic --add <E> <N...> [--before <M> | --after <M>]` — never a hand edit. Same criteria as
`kickoff`. If what remains needs a person, park **that** child and move on. Splitting alone never adds
`needs-decision` to the promoted epic.
