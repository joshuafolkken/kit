# The split assessment — one definition, every entry point

Before work on an Issue starts, decide whether it is **one** deliverable or several; every entry
point applies this.

## The question

**The default is not to split.** Two questions have to answer yes **together**:

1. Mergeable parts (separability)?
2. Over guide? (test files excluded) Docs/snapshots/listings count.

The same trailing 3-day period as the implement budget;
median implement minutes per 100 actual changed lines;
implement budget ÷ measured minutes per 100 lines × 100 → line guide;
line guide × (fallback file guide / fallback line guide) → file guide.
Floor (also the unmeasured fallback):
**more than 8 changed files or more than 200 changed lines**.

Past **the cap (1.5 × guide)** or the bar (2 × budget): split or say why.
Merged lanes' median actual / declared ratios per axis, apart from speed; unmeasured: 2.
First `lane:plan` answers `split` past declared files × files ratio (files, hunks), bar (lines);
`--single`, a re-plan or a dispatched lane → `size warning` (`lane-plan-size.ts`).

## The same two questions decide the filing-time fold

**The entry's split decision and the filing-time fold decision are the same two conditions, stated
here once** — the fold asks whether *several findings from one session* are one Issue, with the same
conjunction. `pnpm josh issue:fold "<title>" …` answers `fold` / `separate` / `no-fold-needed`; its size
half is `pnpm josh split:assess`, called not recomputed. A diff with no readable non-test file answers
`undetermined`, and the size is the request's estimate. **There is no second criterion.**
`observation-filing.md`'s observation, the review round cap's branch 2 and `prerequisite.md`'s
prerequisite each route a second filing through it — `pnpm josh issue:file` asks it itself at the
run's second filing, never the first, and holds only a `fold`.

## Diff size is not a reason to split, and that is measured

**Size is a bar a split has to clear; it is never a reason to split.** **A proposal to add a size
threshold that splits more is required to say why the round-1 measurement does not reach it.**

**The size half is measured, not eyeballed — `pnpm josh split:assess`** counts the branch's changed
files and lines, test files excluded, and answers `split` / `single` on size alone. Separability stays
a judgement, so its `split` is the size condition met, not a decision to divide.

## Over the guide before the gate

**Size is judged before dispatch: at filing (`issue:file`) and at `lane:plan` only.
A dispatched lane is never split: it is finished to the end, and never splits, spills or stops for size.**

**Trigger: a dispatched lane's first `lane:plan` is past its bar.** It answers `clear` with one
`size warning` and nothing on the ledger; a re-plan, `run:cut` and `run:chain` print none. Go on implementing.

- An independent new requirement found in the lane → file it as an observation, without `--route split`.
  `issue:file --route split --found-during <N>` from lane `#N` is refused.
- At the merge, a diff past the Issue's declared size × the growth factor, capped at the guide
  (no declaration: the guide), on either axis, is recorded as a pre-split miss with its declared and
  actual size (`scripts/lane/lane-size-record.ts`). `pnpm josh lane:stats --period <days>` counts and lists the misses;
  use them to tune the pre-dispatch assessment.

The quality gates, the clash and unread checks, and the review stay stops. The warning never creates an epic.

## What each entry point does with the answer

| Entry | Single | Two or more |
| --- | --- | --- |
| `kickoff new` | Create one Issue, post the plan, stop | Create the children, create a **new epic**, stop |
| `kickoff #N` | Post the plan on `#N`, stop | Create the children, then **promote `#N`** or create a new epic (below), stop |
| `fullrun new` / `halfrun new` | Proceed as usual | Create the children and the epic, then **stop** |
| `fullrun #N` / `halfrun #N` | Proceed as usual | Create the children, promote or create the epic, then **stop** |

## A prerequisite is not a split

A split means the request contains several deliverables; a prerequisite means it is **one** deliverable
with another in front of it. `prerequisite.md` is the single source; each entry's branch is in
`backlogrun-park.md` → "A prerequisite discovered mid-run" and `fullrun.md` / `halfrun.md`.

## Two or more always means an epic

**Splitting into two or more Issues always creates an epic. There is no count threshold and no ordering
condition to evaluate.** **An entry point that applies a different condition is a defect.** The epic
is the non-closing home for the split rationale.

**Each split child is filed with the `route:split` label** —
`pnpm josh issue:file "<sub-title>" --body-file .josh/tmp/body.md --route split` — and judged like any
filing (`kickoff.md` → "Words typed after `new`").

## Promote, or create a new epic

`kickoff #N` and the `#N` runs have one branch, and it is Tier A — decide it and record the reasoning
on the Issue, without asking.

- **`#N` is a request, a discussion, or a container → promote it.**
  `pnpm josh epic --promote <N> <N1> <N2> ... [--ordered]`. The body is appended to, never replaced.
- **`#N` is itself one of the deliverables → keep `#N` as a child and create a new epic** — e.g. a bug
  report that needs three fixes.

## `backlogrun` is the one entry that does not stop

A split found under `backlogrun` is filed and continued through — including from a bare, non-epic
Issue, where the split creates the epic (`backlogrun-child.md` → "When `#N` is not an epic").

## Finding a split mid-run stops the run

`fullrun` and `halfrun` **stop** after filing the children and the epic — typing `fullrun` approved
**one** Issue. Report what was filed and end with:

> Please run `pnpm josh backlogrun <E> --only` to execute this epic.

## There is no `kickoff epic`

It would duplicate `kickoff new`; the assessment above reaches a split from every entry.

## Issues filed separately, found related later

Not a split — `pnpm josh epic --promote` handles it.
