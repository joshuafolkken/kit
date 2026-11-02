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

A child carrying **`needs-human-review`** stops `halfrun`-shaped in **its own lane**:
implementation and the gate run, nothing is committed, the tree is left dirty and unstashed,
`pnpm josh run:hold <N> --human-review-stop` sends the `confirmation` Telegram with the resume command
and the lane directory. The parent collects that dispatch and offers the next children.

**The child goes on holding its repository**, and **its lane is left open and untouched**. **Name the
lane directory in the stop report.** The stopped lane stays counted in use by `lane:limit`;
never park or release it. The parent keeps launching children while free lanes remain. A fresh
dispatch resumes the lane's normal lifecycle after the person reviews it.

**Never apply or remove the label** — a person's alone (`needs-human-review.md`, the single source).

## park and continue

When a child hits something only a person can decide (→ "Only a person's judgement carries
`needs-decision`"), **park the child and keep going**:

```bash
pnpm josh run:park <N> --body-file <path>   # what needs deciding, and the options; applies needs-decision, then releases
```

The one call also runs `run:release <N>`, so the parked child holds neither the tree nor
`in-progress`; a failed release prints `pnpm josh run:release <N>` to re-run. A tree whose hold names
another run (a split lane parking a leftover child) is left to that run's own release. Return to
step 1.

**What happens to a parked child's lane** — `backlogrun-lanes.md` → "What happens to a lane".

**Parking keeps the stop's rule** — file upstream defects; never work around them.
`epic:bundle`'s `ask` is Tier A (`epic-commands` skill).

**Removing the label is Tier A — do it without asking**, once the decision is recorded:

```bash
pnpm josh run:park <N> --clear   # succeeds when the label is already off
```

**The released child goes back to a lane, never into the parent's own context** — `pnpm josh
lane:launch <N>`.

## Only a person's judgement carries `needs-decision`

**`needs-decision` means "a person has to choose", and nothing else.** It carries only:

- a Tier B toss-up with no recommendation, or a Tier C action (decision-autonomy below);
- an upstream defect in another package, whose wait-or-defer is the person's (`upstream-interrupt.md`);
- information only the web holds — no lane launches a web tool (`scripts/agent/claude-agent-argv.ts`),
  so a person fetches it.

It never carries:

- a recommended, reversible choice — Tier A: adopt it, record it in the epic's Decisions and child
  comment with `pnpm josh epic --decide <E> <N...> --decision-file <path|->`, and continue
  (`prompts/collaboration-workflow/operating-rules.md` → "decision-autonomy", the single source).
  `run:park` refuses `推奨` / `recommend` (case-insensitive); Tier C still needs explicit authorization;
- whether to run something already planned and opted in with `auto-ok` — the opt-in is that decision;
- a wait for the next published release — a dependency, `pnpm josh issue:release <N> --wait`
  (`prerequisite.md`);
- a defect in the running repository's own run tooling — the run fixes it and resumes
  (`prompts/collaboration-workflow/upstream-interrupt.md` → "実行中のリポジトリ自身のラン機構の不具合"),
  its filing carrying the `- 原因の park:` line when it parked or stopped an Issue (`issue-template.md` → I);
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

```bash
pnpm josh run:stale
```

It removes the label only where nothing holds it, keeps a real hold (a dirty checkout, a live run),
and leaves a closed issue alone; report each `kept` / `removed` line. The test is
`docs/josh-commands-run.md` → "`josh run:stale`".

## A prerequisite discovered mid-run

Something else in **this** repository has to land first: not a split, not an upstream defect. File it
(`route:tier-a`) and set the child in hand `<M>` aside with `run:pause` — `prerequisite.md`, the single source of the
distinction, the filing, the pause and the ceiling. Then:

1. **Do not park.** Back to step 1 of the loop; `epic:next` hands back the prerequisite first.
2. Pop the stash the pause comment names when `epic:next` offers `<M>` again, after its
   `pnpm josh ms`; expect conflicts.

## Splitting a child mid-run

Not a reason to stop. File the new children (Tier A, first-party; `split-assessment.md` → "Two or
more always means an epic"), then
`pnpm josh epic --add <E> <N...> [--before <M> | --after <M>]` — never a hand edit. Same criteria as
`kickoff`. If what remains needs a person, park **that** child and move on. Splitting alone never adds
`needs-decision` to the promoted epic.
