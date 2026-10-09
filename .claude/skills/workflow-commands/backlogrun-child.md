# `backlogrun` — running a child (shared mechanics, delegation, liveness, session setup)

Point-of-use, read one section at a time from `backlogrun.md` → "The route table" (rationale: `docs/maintainers/backlogrun-child-rationale.md` → "Why the file is read by section").

## Running a child — the shared mechanics

Everything below runs **one child** — of a named epic, or of the opted-in backlog. A single-issue named item, a named epic's child and a bare backlog child all run the same `fullrun` in the same way, and this part is the single source of how. A named epic runs these mechanics over its own children until every one is processed, then the run advances to the next named item.

## When `#N` is not an epic

`backlogrun` accepts an ordinary Issue as well as an epic. `backlogrun #<N>` on an Issue with no task list
runs `#<N>` as a `fullrun` and then finishes. Inside `backlogrun #<N>`, a prerequisite or a split found
mid-run does **not** stop the run (rationale: `docs/maintainers/backlogrun-child-rationale.md` → "Why a
bare Issue promotes itself under `backlogrun` but not under `fullrun`"):

1. File the new Issue(s) with the matching route label — `route:split` for a split, `route:tier-a`
   for a prerequisite — no confirmation.
2. **Stash the work in progress and remove `in-progress` from `#<N>`**, exactly as steps 2 and 4 of
   "A prerequisite discovered mid-run" do — `git stash push -u -m "..."` with the `-u`, the
   `gh api repos/{owner}/{repo}/issues/<N>/comments` post that records the stash, and
   `pnpm josh run:release <N>`, which removes the label with the hold.
3. **Ask `pnpm josh epic:bundle <N>` whether an epic already tracks `#<N>` before creating one.**

   | Answer | What to do |
   | --- | --- |
   | An epic `#<E>` already tracks `#<N>` | `pnpm josh epic --add <E> <P> --before <N>` for a prerequisite, or `--add <E> <N1> ...` for a split. **Do not create a second epic.** Continue the loop against `#<E>` |
   | No epic tracks it | Create one — the command depends on what was found (table below) |
   | **The command could not answer** — a non-zero exit, `Could not confirm which epic already tracks these — do not place this issue in one.`, or a ⚠ warning about a truncated listing (beginning `⚠ The epic listing …`, in either form `hit its …-epic cap` / `stopped at the …-issue page ceiling`) above a `Nothing to bundle.` verdict; `⚠ Could not read #N.` is one failed relation read and voids nothing, and a definitive answer stands even beside a warning | Park `#<N>` with `needs-decision` and report. "Could not tell" is not "no epic tracks it" |

   When creating one, `#<N>` is itself one of the deliverables — this path always takes the
   keep-as-a-child arm of `split-assessment.md`'s promote-or-create branch. Which command depends on
   what was found, because `--ordered` makes the argument order the dependency chain:

   | Found | Command |
   | --- | --- |
   | A prerequisite `<P>` | `pnpm josh epic "<title>" <P> <N> --ordered` — the prerequisite comes **first** |
   | A split into independent children | `pnpm josh epic "<title>" <N> <N1> ...` — **no `--ordered`** |
   | A split whose children do have an order | `pnpm josh epic "<title>" ... --ordered`, arguments in that order |

4. **Run `pnpm josh epic:audit <E>` now**, not earlier — there is no epic to audit until step 3.
5. **Do not stop.** Continue into the loop below against the new epic `#<E>`.

**Nothing found means no epic.** If `#<N>` reaches its merge without a prerequisite or a split turning
up, the run finishes there. An epic is created only when there is a second child to put in it.

**Every guard below applies on this path unchanged** — 30 children, 10 Issues filed, 3 consecutive
failures.

**This does not let `fullrun` promote itself.** A `fullrun` that discovered a split still files the
children and the epic and then **stops** (`split-assessment.md` → "Finding a split mid-run stops the
run").

**`josh epic:next` is not changed by any of this.** It still refuses an Issue with no task list; the
acceptance of a bare Issue belongs to `backlogrun`.

**Naming a bare Issue beside an epic is a mistyped command rather than a second entry.** Where one
reference is named, the refusal is the whole answer. Where several are, a task-listless reference is
**skipped** so the other epics keep running — `backlogrun #<E> --only #<N>` with `#<N>` an ordinary Issue exits
0, notes the skip on standard error, and **never runs `#<N>`**. A run that means to do both types
`backlogrun #<N>` on its own after the epic.
## Each child runs in a delegated unit

**A child is not run in the parent loop's context** — **whatever offers a child — the loop, or a
person clearing a label — the child is handed to a lane, never to the parent.** `pnpm josh delegate
epic-child` answers `delegate`; in a lane the unit is a detached process started by `pnpm josh
lane:launch` (`backlogrun-lanes.md` → "Opening one lane and dispatching its child"), with the invoking
CLI's `worker` profile — Claude Code defaults to Anthropic `claude-opus-5-5` / `medium`
(`docs/josh-commands-run.md` → "`josh lane:dispatch`", the single source).
Where no isolated unit exists, run the child in the parent's context; the hand-off is still asked at
every merge. Rationale: `docs/maintainers/backlogrun-child-rationale.md` → "Why each child runs in a
delegated unit".

**The parent reads GitHub, never the summary** — `pnpm josh issue:state <N>` (or `run:merge`) is the
verifier; **never advance the loop on the summary alone**.

**The brief names the invocation it descends from** — e.g. `backlogrun #<E> --only`, the child number,
and that the child runs as `fullrun #<N>` under that authorization; the unit refuses a brief without it.

### What the summary carries, and how long it may be

**The summary carries only what GitHub does not, in at most 25 lines; the brief states the bound.**
Rationale: `docs/maintainers/backlogrun-child-rationale.md` → "Why the summary is bounded the way it is".

- **Kept**: `Cause` / `Fix` / `Result`; every verification result not closed the ordinary way, named
  as such; observations that could bite later — **the only route a child's discretionary observation
  has** (`observation-filing.md` → "A delegated child does not take this route"); decisions not already
  logged; what was left undone, and under whose authority.
- **Cut**: the changed-file list, per-round review detail, and restated rules.

The person-facing report (`prompts/collaboration-workflow/report-format.md` → 「完了報告（セッション向け）」)
is unchanged.

## A delegated unit that stopped without reporting

**Hand the child to the unit without blocking on its return, and poll** — a stopped unit leaves no
notification behind. Once its output has been unchanged for the silent-unit window, read
`backlogrun-recovery.md` → "A delegated unit that stopped without reporting" and ask
`pnpm josh run:liveness`.

## Audit before the first child

Run `pnpm josh epic:audit <E>` before step 1 below. **When the run began from a bare Issue there is
nothing to audit yet** — that path runs the audit at the moment it creates the epic instead. Errors
stop the run; warnings are read and carried on past. Fixing what it finds is Tier A. Rationale:
`docs/maintainers/backlogrun-child-rationale.md` → "Why the audit runs before the first child".

## `josh latest` runs once per session, not once per child

`josh latest` belongs to the **session**, not to a child. Ask once, the first time the loop below hands
back a child number — before implementing that child — and never again:

```bash
pnpm josh latest:scope   # → required | skip ; the reason on stderr
git stash push -u -m "backlogrun: josh latest #<N>"        # only if the tree has staged or modified files — never conditional on the answer
pnpm josh ms
pnpm josh latest         # on `required` only
pnpm josh stash:pop "backlogrun: josh latest #<N>"         # only if you stashed above — by message, not a positional pop
```

On `required`, load the `dependency-update` skill; `latest-gate.md` is the single source. **Session,
not run** — each session updates its own checkout, and a resumed `backlogrun` asks again. **The lock
file lands with the first child's `pnpm josh git -y`**; fix a failing bump forward. **`josh latest` is
never run inside a lane** (`pnpm josh latest:guard` refuses it) — with lanes the parent runs it in the
primary checkout (`backlogrun-lanes.md` → "Once per repository, before the first lane opens").

Rationale: `docs/maintainers/backlogrun-child-rationale.md` → "Why `josh latest` is hoisted to the
session".

## Preflight — the child's claim asks it

`pnpm josh run:hold <N>`, the first call of the child's `fullrun`, checks for an interrupted run's
leftovers before it claims the tree, and prints the step for each answer (`reclaim` / `resume` /
`park`) on stderr — follow it, and report a reclaim or resume with its stash reference. The answers are
`docs/josh-commands-run.md` → "`josh run:hold`"; rationale:
`docs/maintainers/backlogrun-child-rationale.md` → "Why the preflight is part of the claim".

