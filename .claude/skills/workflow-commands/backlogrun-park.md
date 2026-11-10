# `backlogrun` — a child that cannot finish

**Read this file in full when a child cannot finish** — before parking it, before a
`needs-human-review` stop, or before recording a mid-run prerequisite or split.

## The parent does not investigate a lane failure itself

**A lane failure whose reason is not on its Issue is read by a unit** — `pnpm josh delegate
lane-failure-investigation`; the parent checks the cited lines and `pnpm josh issue:state` before it
parks, re-dispatches or files.

## `needs-human-review` — the one stop that is not a park

A child carrying **`needs-human-review`** stops `halfrun`-shaped in **its own lane**:
implementation and the gate run, nothing is committed, the tree is left dirty and unstashed,
`pnpm josh run:hold <N> --human-review-stop` sends the `confirmation` Telegram with the resume command
and the lane directory. The parent collects that dispatch and offers the next children.

**The child goes on holding its repository**, and **its lane is left open and untouched** — never
park or release it. **Name the lane directory in the stop report.** The parent keeps launching
children while free lanes remain.

**Never apply or remove the label** — a person's alone (`needs-human-review.md`, the single source).

## park and continue

When a child hits something only a person can decide (→ "Only a person's judgement carries
`needs-decision`"), **park the child and keep going**:

```bash
pnpm josh run:park <N> --body-file .josh/tmp/park.md   # body schema: docs/josh-commands-run.md → "josh run:park"; applies needs-decision, then releases
```

Return to step 1.

**What happens to a parked child's lane** — `backlogrun-lanes.md` → "What happens to a lane".

**Parking keeps the stop's rule** — file upstream defects; never work around them.
`epic:bundle`'s `ask` is Tier A (`epic-commands` skill).

**Removing the label is Tier A — do it without asking**, once the decision is recorded:

```bash
pnpm josh run:park <N> --clear   # succeeds when the label is already off
```

**The released child goes back to a lane, never into the parent's own context** — `pnpm josh
lane:launch <N>`.

An interrupt filed for a parked child turns the park into a wait — `issue:file --route interrupt
--found-during <N>` (`scripts/issue/issue-file-interrupt.ts`); its merge relaunches #N
(`backlog_drive_retry.after_merge`).

## Only a person's judgement carries `needs-decision`

**`needs-decision` means "a person has to choose", and nothing else.** It carries only:

- a Tier B toss-up with no recommendation, or a Tier C action (decision-autonomy below);
- an upstream defect in another package, whose wait-or-defer is the person's (`upstream-interrupt.md`);
- information only the web holds — no lane launches a web tool (`scripts/agent/claude-agent-argv.ts`),
  so a person fetches it.

It never carries:

- a recommended, reversible choice — Tier A: adopt it with
  `pnpm josh backlog:triage --apply <N> --adopt <k> --reason <text>`, and continue
  (`prompts/collaboration-workflow/operating-rules.md` → "decision-autonomy", the single source);
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

### A park the parent session resolves

A recommendation the child lacked the permission to take → the parent runs
`pnpm josh backlog:triage --apply <N> --adopt <k> --reason <text>` (tiers: `operating-rules.md` →
"decision-autonomy"): a scoped size approval, a premise the body constrains, a run-tooling defect to
file. An option whose `必要な権限` starts with `親` → carry it out first, then adopt it with
`--done <what was done>`. A dependency → `--apply <N> --blocked-by <M>` / `--unblock <M>`. No tracking epic → comment the
decision, `run:park <N> --clear`, `run:add <N> --retry`.

### A park left for a person

`推奨なし`, a trust or security setting, an upstream defect, a third-party write, a destructive
operation, or web-only information.

## `in-progress` is removed by whoever finds it stale

**A session that detects a stale `in-progress` on any open issue in the repository — not only this
epic's children (`epic:next` names the holders on standard error) — runs `pnpm josh run:stale`**
(Tier A) before continuing, and reports each `kept` / `removed` line (`docs/josh-commands-run.md` →
"`josh run:stale`").

## A prerequisite discovered mid-run

Something else in **this** repository has to land first: not a split, not an upstream defect. File it
(`route:tier-a`) and set the child in hand `<M>` aside with `run:pause` — `prerequisite.md`, the
single source of the distinction, the filing, the pause and the ceiling. Then:

1. **Do not park.** Back to step 1 of the loop; `epic:next` hands back the prerequisite first.
2. Resume as the pause comment names when `epic:next` offers `<M>` again: on its lane branch the
   WIP commit is already there — `pnpm josh main:merge` and continue; a stash is popped after
   `pnpm josh ms`.

## Splitting a child mid-run

Not a reason to stop. File the new children (Tier A, first-party; `split-assessment.md` → "Two or
more always means an epic"), then
`pnpm josh epic --add <E> <N...> [--before <M> | --after <M>]` — never a hand edit. Same criteria as
`kickoff`. If what remains needs a person, park **that** child and move on. Splitting alone never adds
`needs-decision` to the promoted epic.
