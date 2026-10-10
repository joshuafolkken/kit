# `backlogrun` — a child that cannot finish

**Read this file in full when a child cannot finish** — before parking it, before a
`needs-human-review` stop, or before recording a mid-run prerequisite or split. It is a point-of-use
document, never an entry read: the entry procedure is `backlogrun.md`, which points here at that
moment. This file is the single source of park-and-continue, the
`needs-human-review` stop, a stale `in-progress`, a prerequisite discovered mid-run, and a mid-run
split. Provenance of each rule: `docs/maintainers/backlogrun-park-rationale.md` → "Where each rule came from".

## What happens to a child that cannot finish

Nothing here is new, and nothing here is restated — a `backlogrun` child is a `fullrun` under a batch
authorization, whether it came from a named epic or from the opted-in pool:

- **A stop that would end the run parks one issue and the run continues** — → "park
  and continue", which is that rule's single source, including what happens to the issue's lane.
- **A prerequisite discovered mid-run is recorded as a dependency rather than parked** —
  → "A prerequisite discovered mid-run", and `prerequisite.md` for the three-way
  distinction between a prerequisite, a split and an upstream defect. With no epic there is no
  `pnpm josh epic --add` to record the ordering into, so the `blocked-by` relation is written on the
  issue itself (step 3 below) — still a dependency, never a `needs-decision` park.
- **A split found mid-run** files the children and the epic and does not stop the batch, because the
  keyword already authorized a batch — `split-assessment.md` for the assessment, → "Splitting a child
  mid-run" for the branch. The split child is not parked or counted as a failure; its new children
  remain available to the normal `backlog:next` / `epic:next` offer.
- **`in-progress` left behind by an interrupted run** is → "`in-progress` is removed by
  whoever finds it stale".
- **A child released from `needs-decision` is re-dispatched to a lane, never implemented by the
  parent.** The parent is an orchestrator: `backlogrun.md` → "Claim nothing at the entry — this
  parent orchestrates and never implements" is the single source, and "Removing the label
  is Tier A" below carries the re-dispatch itself. A released child takes a lane exactly as any batch child
  does.

## The parent does not investigate a lane failure itself

**A lane failure whose reason is not on its Issue is read by a unit** — `pnpm josh delegate
lane-failure-investigation`; the parent checks the cited lines and
`pnpm josh issue:state` before it parks, re-dispatches or files.

## `needs-human-review` — the one stop that is not a park

A child carrying **`needs-human-review`** is degraded to a `halfrun`-shaped stop and **the whole run ends
there** — implementation and the verification gate run, nothing is committed, the working tree is left
dirty and unstashed, a `confirmation` Telegram carrying the resume command goes out, and the remaining
children are not started.

**This is the exception to park-and-continue below** — rationale:
`docs/maintainers/backlogrun-park-rationale.md` → "Why `needs-human-review` ends the run instead of parking".

**The child goes on holding its repository.** `needs-decision` outranks `in-progress` in the
per-repository exclusion so a parked child releases the checkout; this label deliberately does not,
because releasing it would start the next child on top of uncommitted work. **Its lane is left open and
untouched**, for the same reason. **Name the lane directory in the stop report and in the Telegram.** The lanes
already in flight finish; no new lane is opened.

**Never apply or remove the label** — a person's alone. Full definition and the
`needs-decision` comparison: `needs-human-review.md`, which is the single source.

## park and continue

When a child hits something only a person can decide — → "Only a person's judgement carries
`needs-decision`" below — **park the child and keep going.**

```bash
gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=needs-decision'
pnpm josh issue:comment <N> --body-file <path>   # what needs deciding, and the options
```

`in-progress` is left as it is, and the parked child does **not** hold the repository — `epic:next` gives
`needs-decision` precedence over `in-progress`, so the next child is offered normally. Then return to
step 1; the other children are unaffected unless they depend on this one.

**A parked child's lane is kept, whether or not it had committed**, and every parked ending owes
`pnpm josh run:release <N>` — `backlogrun-lanes.md` → "What happens to a lane", the single source. A
lost merge race resolves in its lane instead (`backlogrun-recovery.md` → "Conflicts are not predicted").

**Parking replaces stopping the session, not the rule that produced the stop** — an upstream defect is
still filed at once, and a workaround is still forbidden. `epic:bundle`'s `ask` is Tier A, not a park:
add the epic you recommend with `pnpm josh epic --add <E> <N> --after <M>` and record it on both
Issues' `## Decisions`.

**Removing the label is Tier A — do it without asking**, once the decision is recorded; without it the
parked child never runs again:

```bash
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/needs-decision 2>/dev/null || true
```

**The released child goes back to a lane, never into the parent's own context** — `pnpm josh
lane:launch <N>` (`backlogrun.md` → "Claim nothing at the entry — this parent orchestrates and never
implements").

## Only a person's judgement carries `needs-decision`

**`needs-decision` means "a person has to choose", and nothing else.** This is the single source of
when a run may apply it, by hand or through a park. It carries only:

- a design choice nobody has made;
- a Tier B toss-up, or a Tier C action (`CLAUDE.md` → "Decision autonomy");
- an upstream defect in another package, whose wait-or-defer is the person's (`upstream-interrupt.md`).

It never carries:

- a choice with a clearly better default — that is Tier A: decide it and record it as an Issue comment;
- whether to run something already planned and opted in with `auto-ok` — the opt-in is that decision;
- a defect in the running repository's own run tooling — the run fixes it and resumes
  (`prompts/collaboration-workflow/upstream-interrupt.md` → "実行中のリポジトリ自身のラン機構の不具合").

**When in doubt, it is Tier A**: decide, comment the decision, and continue. **A label a mechanical step applied** — a
failed or abandoned child, a lost merge race's four conditions — is read against this list once its
reason is known, and removed (Tier A, above) when the reason is not on it. Rationale:
`docs/maintainers/backlogrun-park-rationale.md` → "Why a run spends no attention on a non-finding".

## `in-progress` is removed by whoever finds it stale

A run's own ending removes `in-progress` — `pnpm josh followup` on a merge, `pnpm josh run:release <N>`
on a stop. An interrupted run reaches neither and leaves it behind, and a child that carries it is
excluded from every future `epic:next` — permanently. The removal below is the one hand-written call
left, for a label no live run owns: another tree's record is not this tree's to release.
**A session that detects a stale child removes the label itself** (Tier A) and reports it, before
continuing the loop.

**It costs more than that one child now.** An open issue carrying `in-progress` occupies one of the
repository's lanes — whichever epic it belongs to — so a stale label narrows every epic that touches
that checkout. **The rule therefore applies to any open issue in the repository, not only to this epic's
children**, and `epic:next` names the holders on standard error. **Age alone is not the test.** Check the
90-minute window below *and* look at what is holding it, because three states hold the label legitimately
for longer: a `halfrun` stopped for manual verification, any run paused mid-child, and a child stopped by
`needs-human-review` (which waits on a person reading an artifact, and carries its own label alongside
`in-progress`). **All three leave uncommitted work in the checkout**, so `git status` there is the
decisive read: a dirty tree means the hold is real — leave the label alone and report, never strip it and
start a second child on top of that work.

**A closed issue's labels are neither a finding nor something to clean up.** A closed issue holds no lane
(`epic-busy.ts` counts holders from the open listing alone) and `epic:next` never offers it, so
`in-progress` left behind on one changes nothing. **Do not report it, and do not strip it.**

```bash
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true
```

## A prerequisite discovered mid-run

Finding that something else in **this** repository has to land first is not a split, and not an upstream
defect. The child in hand is still one deliverable; it just needs another one before it. The three-way
distinction, the `route:tier-a` filing command and the filing ceiling are `prerequisite.md`, the single
source; what follows is this entry's branch.

`<M>` below is the child being implemented when the prerequisite turned up; `<N>` is the new Issue.

1. File the prerequisite Issue `<N>` with the `route:tier-a` label — Tier A for a first-party
   repository, no confirmation. It is filed **first** because the next step names it.
2. **Stash the work in progress.** A child is implemented on the default branch with an uncommitted tree,
   so `<M>`'s half-finished edits are sitting there, and the next child's `pnpm josh ms`
   would refuse or carry them into the prerequisite's branch and PR.

   ```bash
   git stash push -u -m "backlogrun: paused #<M> for prerequisite #<N>"
   pnpm josh issue:comment <M> --body-file <path>   # what was stashed, and that #<N> must land first
   ```

   **`-u` is not optional** (a new `*.test.ts` is untracked). The comment makes the paused state
   auditable and tells the session that resumes `<M>` a stash is waiting. **Pop it by message, never by
   position** — `pnpm josh stash:pop "backlogrun: paused #<M> for prerequisite #<N>"` — when `epic:next`
   offers `<M>` again, after its `pnpm josh ms`. The stash is a repository-wide stack
   every lane shares, so a bare `git stash pop` would take whichever lane last pushed; the message
   targets this one. The prerequisite has merged by then, so expect to resolve conflicts.

3. `pnpm josh epic --add <E> <N> --before <M>` — one command writes the task-list row, the declaration
   and the `blocked-by` relation together. Never edit the body by hand: the declaration and the relations
   then disagree, `epic:next` returns `error`, and the unattended run stops.
   **With no epic** (a pool child), record the relation alone, `<M>` blocked by `<N>`, with the
   `gh api …/dependencies/blocked_by` call in `prompts/collaboration-workflow/issue-template.md` →
   "複数 Issue に分割するときの epic Issue", step 4.
4. **Remove `in-progress` from `<M>`** — `pnpm josh run:release <M>`, which removes the label with the hold.
   This is what lets `<M>` run again: `epic:next` classifies a child carrying `in-progress` as waiting on
   time **before** it looks at any blocker, so a child left labelled is never offered again.
5. **Do not park.** Go back to step 1 of the loop. `epic:next` classifies the original child as resolving
   on its own and hands back the prerequisite first, so the order is kept with no human input.

**A stop a dependency can express is never parked**, and a defect in this repository's own gate or run
tooling is such a stop — `prerequisite.md` holds that rule and what the driver does with it.

## Splitting a child mid-run

Discovering that a child is really several is not a reason to stop. File the new children with the
`route:split` label (Tier A for a first-party repository — no confirmation), then add them with
`pnpm josh epic --add <E> <N...> [--before <M> | --after <M>]` rather than editing the epic body by hand.
Use the same split criteria as `kickoff`. If what remains of the original child needs a person, park
**that** child and move on. Splitting alone never adds `needs-decision` to the promoted epic.
