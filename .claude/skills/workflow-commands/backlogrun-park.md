# `backlogrun` — a child that cannot finish

**Read this file in full when a child cannot finish** — before parking it, before a
`needs-human-review` stop, or before recording a mid-run prerequisite or split. It is a point-of-use
document, never an entry read: the entry procedure is `backlogrun.md`, which points here at that
moment (joshuafolkken/kit#2010). This file is the single source of park-and-continue, the
`needs-human-review` stop, a stale `in-progress`, a prerequisite discovered mid-run, and a mid-run
split.

## What happens to a child that cannot finish

Nothing here is new, and nothing here is restated — a `backlogrun` child is a `fullrun` under a batch
authorization, whether it came from a named epic or from the opted-in pool:

- **A stop that would end the run parks one issue and the run continues** — → "park
  and continue", which is that rule's single source, including what happens to the issue's lane.
- **A prerequisite discovered mid-run is recorded as a dependency rather than parked** —
  → "A prerequisite discovered mid-run", and `SKILL.md` → §2d for the three-way
  distinction between a prerequisite, a split and an upstream defect. **One thing is genuinely
  different**: with no epic, there is no `pnpm josh epic --add` to record the ordering into, so the
  prerequisite is filed with `route:tier-a` and the blocked issue is parked with `needs-decision`
  naming it. The parked issue returns to the pool when a person clears the label, and the
  prerequisite is offered on the next ask if it carries `auto-ok`.
- **A split found mid-run** files the children and the epic and does not stop the batch, because the
  keyword already authorized a batch — `split-assessment.md` for the assessment, → "Splitting a child
  mid-run" for the branch.
- **`in-progress` left behind by an interrupted run** is → "`in-progress` is removed by
  whoever finds it stale".
- **A child released from `needs-decision` is re-dispatched to a lane, never implemented by the
  parent.** The parent is an orchestrator: → "The parent orchestrates and never
  implements a child in its own context" is the single source, and → "Removing the label
  is Tier A" carries the re-dispatch itself. A released child takes a lane exactly as any batch child
  does.

## `needs-human-review` — the one stop that is not a park

A child carrying **`needs-human-review`** is degraded to a `halfrun`-shaped stop and **the whole run ends
there** — implementation and the verification gate run, nothing is committed, the working tree is left
dirty and unstashed, a `confirmation` Telegram carrying the resume command goes out, and the remaining
children are not started.

**This is the exception to park-and-continue below, and it is not an oversight.** Parking works because
the parked child leaves the checkout clean; this child does not. Its uncommitted work is the artifact a
person has to look at — which is why the alternative that kept the batch running (commit, open a PR,
merge nothing) was rejected: it satisfies "a person approves publication" and fails "a person chooses".

**The child goes on holding its repository.** `needs-decision` outranks `in-progress` in the
per-repository exclusion so a parked child releases the checkout; this label deliberately does not,
because releasing it would start the next child on top of uncommitted work. **Its lane is left open and
untouched**, for the same reason. **Name the lane directory in the stop report and in the Telegram** — a
person told to look at a working tree and not told which one has been told nothing. The lanes already in
flight finish; no new lane is opened.

**Never apply or remove the label** — `auto-ok`'s rule, at `auto-ok`'s strength. Full definition and the
`needs-decision` comparison: `SKILL.md` → §2z, which is the single source.

## park and continue

When a child hits something this run may not decide — a Tier B toss-up, a Tier C action, an upstream
defect, a split that needs a person — **park the child and keep going.**

```bash
gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=needs-decision'
pnpm josh issue:comment <N> --body-file <path>   # what needs deciding, and the options
```

`in-progress` is left as it is, and the parked child does **not** hold the repository — `epic:next` gives
`needs-decision` precedence over `in-progress`, so the next child is offered normally. Then return to
step 1; the other children are unaffected unless they depend on this one.

**What happens to a parked child's lane depends on whether it had committed, and the two answers are
opposite.** **Parked before its commit**, the lane is stashed and closed:
`git -C <dir> stash push -u -m "backlogrun: parked #<N>"`, the stash recorded on the Issue, then
`pnpm josh lane:close <N>` (`epic:next` counts a parked child's lane as released, and `lane:close`
removes the work tree by force). **Parked after its commit and push**, the lane is *kept*: nothing to
stash, and closing would delete the local branch the resume needs. **A lost merge race is not one of
these rows** — it resolves in its lane ("Conflicts are not predicted" above), and parks only under that
section's four conditions, which take the after-commit row. Both rows and the `pnpm josh run:release
<N>` every parked ending owes are "What happens to a lane" above, the single source.

**Parking replaces stopping the session, not the rule that produced the stop.** An upstream defect is
still filed immediately and unconditionally (Tier A for a first-party target), and a workaround is still
forbidden. **A placement choice is not one of the things this run may not decide.** `epic:bundle`'s
`ask` is Tier A: choose the epic you recommend, add it with `pnpm josh epic --add <E> <N> --after <M>`,
and record the decision on both the new Issue and that epic's `## Decisions`. What remains a park is a
genuine toss-up between two equally apt epics, and that is rare.

**Removing the label is Tier A — do it without asking.** When the decision is recorded (to the epic's
`## Decisions`), remove the label; the state is on GitHub, so the run picks up where it left off.

```bash
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/needs-decision 2>/dev/null || true
```

**The released child goes back to a lane, never into the parent's own context.** A parent that is
*already* running, and clears a label mid-run because a person just answered, dispatches it the same way
rather than picking up its diff itself — `pnpm josh lane:open <N>` then `pnpm josh lane:dispatch <N>`. A
parent that implements the released child inline is the failure the orchestrator rule is written against:
"The parent orchestrates and never implements a child in its own context" above.

Without removing the label the parked child never runs again — it is the second half of the
human-in-the-loop cycle, not an optional tidy-up.

## `in-progress` is removed by whoever finds it stale

Nothing in the codebase removes `in-progress`; a normal finish closes the issue. An interrupted run
leaves it behind, and a child that carries it is excluded from every future `epic:next` — permanently.
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
`in-progress` left behind on one changes nothing. **Do not report it, and do not strip it** — a report is
read as something that needs attention, so a run that lists non-findings is a run whose real findings are
harder to see.

```bash
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress 2>/dev/null || true
```

## A prerequisite discovered mid-run

Finding that something else in **this** repository has to land first is not a split, and not an upstream
defect. The child in hand is still one deliverable; it just needs another one before it. The three-way
distinction, the `route:tier-a` filing command and the filing ceiling are `SKILL.md` → §2d, the single
source; what follows is this entry's branch.

`<M>` below is the child being implemented when the prerequisite turned up; `<N>` is the new Issue.

1. File the prerequisite Issue `<N>` with the `route:tier-a` label — Tier A for a first-party
   repository, no confirmation. It is filed **first** because the next step names it.
2. **Stash the work in progress.** A child is implemented on the default branch with an uncommitted tree,
   so `<M>`'s half-finished edits are sitting there, and the next child's `git switch main && git pull`
   would refuse or carry them into the prerequisite's branch and PR.

   ```bash
   git stash push -u -m "backlogrun: paused #<M> for prerequisite #<N>"
   pnpm josh issue:comment <M> --body-file <path>   # what was stashed, and that #<N> must land first
   ```

   **`-u` is not optional** (a new `*.test.ts` is untracked). The comment makes the paused state
   auditable and tells the session that resumes `<M>` a stash is waiting. **Pop it by message, never by
   position** — `pnpm josh stash:pop "backlogrun: paused #<M> for prerequisite #<N>"` — when `epic:next`
   offers `<M>` again, after its `git switch main && git pull`. The stash is a repository-wide stack
   every lane shares, so a bare `git stash pop` would take whichever lane last pushed; the message
   targets this one. The prerequisite has merged by then, so expect to resolve conflicts.

3. `pnpm josh epic --add <E> <N> --before <M>` — one command writes the task-list row, the declaration
   and the `blocked-by` relation together. Never edit the body by hand: the declaration and the relations
   then disagree, `epic:next` returns `error`, and the unattended run stops.
4. **Remove `in-progress` from `<M>`** — `gh api -X DELETE repos/{owner}/{repo}/issues/<M>/labels/in-progress 2>/dev/null || true`.
   This is what lets `<M>` run again: `epic:next` classifies a child carrying `in-progress` as waiting on
   time **before** it looks at any blocker, so a child left labelled is never offered again.
5. **Do not park.** Go back to step 1 of the loop. `epic:next` classifies the original child as resolving
   on its own and hands back the prerequisite first, so the order is kept with no human input.

**Parking is only for a prerequisite that cannot be expressed as a dependency** — one that needs a design
decision nobody has made, or that is a Tier B toss-up or a Tier C action. Parking one that *can* be
expressed inverts the whole point: `needs-decision` is cleared by a person.

## Splitting a child mid-run

Discovering that a child is really several is not a reason to stop. File the new children with the
`route:split` label (Tier A for a first-party repository — no confirmation), then add them with
`pnpm josh epic --add <E> <N...> [--before <M> | --after <M>]` rather than editing the epic body by hand.
Use the same split criteria as `kickoff`. If what remains of the original child needs a person, park
**that** child and move on.
