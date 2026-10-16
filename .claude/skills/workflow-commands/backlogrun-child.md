# `backlogrun` — running a child (shared mechanics, delegation, liveness, session setup)

Point-of-use, read one section at a time from `backlogrun.md` → "The route table". Reasons:

- `docs/maintainers/backlogrun-child-rationale.md` → "Why the file is read by section"
- `docs/maintainers/backlogrun-child-rationale.md` → "Why a bare Issue promotes itself under `backlogrun` but not under `fullrun`"
- `docs/maintainers/backlogrun-child-rationale.md` → "Why each child runs in a delegated unit"
- `docs/maintainers/backlogrun-child-rationale.md` → "Why the summary is bounded the way it is"
- `docs/maintainers/backlogrun-child-rationale.md` → "Why the audit runs before the first child"
- `docs/maintainers/backlogrun-child-rationale.md` → "Why `josh latest` is hoisted to the session"
- `docs/maintainers/backlogrun-child-rationale.md` → "Why the preflight is part of the claim"

## Running a child — the shared mechanics

This file is the single source of how **one child** runs — a named single-issue item, a named epic's
child and a bare backlog child all run the same `fullrun`. A named epic runs these mechanics over its
children until every one is processed, then the run advances to the next named item.

## When `#N` is not an epic

`backlogrun #<N>` on an Issue with no task list runs `#<N>` as a `fullrun` and finishes. A prerequisite
or a split found mid-run does **not** stop it:

1. File the new Issue(s) — `route:split` for a split, `route:tier-a` for a prerequisite — no
   confirmation.
2. **Stash and remove `in-progress`**, as steps 2 and 4 of "A prerequisite discovered mid-run" do:
   `git stash push -u -m "..."`, a `gh api repos/{owner}/{repo}/issues/<N>/comments` post recording the
   stash, and `pnpm josh run:release <N>`.
3. **Ask `pnpm josh epic:bundle <N>` whether an epic already tracks `#<N>` before creating one.**

   | Answer | What to do |
   | --- | --- |
   | An epic `#<E>` already tracks `#<N>` | `pnpm josh epic --add <E> <P> --before <N>` (prerequisite) or `--add <E> <N1> ...` (split). **Do not create a second epic**; continue against `#<E>` |
   | No epic tracks it | Create one (table below) |
   | **The command could not answer** | Park `#<N>` with `needs-decision` and report — "could not tell" is not "no epic" |

   "Could not answer" is a non-zero exit, `Could not confirm which epic already tracks these — do not
   place this issue in one.`, or a `⚠ The epic listing …` truncation warning (`hit its …-epic cap` /
   `stopped at the …-issue page ceiling`) above `Nothing to bundle.`. `⚠ Could not read #N.` voids
   nothing, and a definitive answer stands beside a warning.

   `#<N>` is itself one of the deliverables (the keep-as-a-child arm of `split-assessment.md`).
   `--ordered` makes the argument order the dependency chain:

   | Found | Command |
   | --- | --- |
   | A prerequisite `<P>` | `pnpm josh epic "<title>" <P> <N> --ordered` — the prerequisite **first** |
   | A split into independent children | `pnpm josh epic "<title>" <N> <N1> ...` — **no `--ordered`** |
   | A split whose children do have an order | `pnpm josh epic "<title>" ... --ordered`, in that order |

4. **Run `pnpm josh epic:audit <E>` now** — there is no epic to audit before step 3.
5. **Do not stop.** Continue into the loop against `#<E>`.

- **Nothing found means no epic** — the run finishes at `#<N>`'s merge.
- **Every guard applies unchanged** — 30 children, 10 Issues filed, 3 consecutive failures.
- **`fullrun` does not promote itself** — it files and **stops** (`split-assessment.md` → "Finding a
  split mid-run stops the run"). `josh epic:next` still refuses an Issue with no task list.
- **A bare Issue named beside an epic is a mistyped command.** Named alone, the refusal is the answer;
  among several, it is **skipped** — `backlogrun #<E> --only #<N>` exits 0, notes the skip on stderr
  and **never runs `#<N>`**. To do both, type `backlogrun #<N>` after the epic.

## Each child runs in a delegated unit

**Whatever offers a child — the loop, or a person clearing a label — the child is handed to a lane,
never run in the parent's context.** `pnpm josh delegate epic-child` answers `delegate`; the unit is a
detached process from `pnpm josh lane:launch` (`backlogrun-lanes.md` → "Opening one lane and
dispatching its child") with the CLI's `worker` profile — Claude Code defaults to Anthropic
`claude-opus-5-5` / `medium` (`docs/josh-commands-run.md` → "`josh lane:dispatch`"). With no isolated
unit, run the child in the parent's context and still ask the hand-off at every merge.

- **The parent reads GitHub, never the summary** — `pnpm josh issue:state <N>` (or `run:merge`)
  verifies; **never advance the loop on the summary alone**.
- **The brief names the invocation it descends from** — e.g. `backlogrun #<E> --only`, the child
  number, and that it runs as `fullrun #<N>` under that authorization; the unit refuses a brief without
  it.

### What the summary carries, and how long it may be

**Only what GitHub does not, in at most 25 lines; the brief states the bound.**

- **Kept**: `Cause` / `Fix` / `Result`; every verification not closed the ordinary way, named as such;
  observations that could bite later — **a child's only route for one** (`observation-filing.md` → "A
  delegated child does not take this route"); decisions not yet logged; what was left undone, on whose
  authority.
- **Cut**: the changed-file list, per-round review detail, restated rules.

The person-facing report (`prompts/collaboration-workflow/report-format.md` → 「完了報告（セッション向け）」)
is unchanged.

## A delegated unit that stopped without reporting

**Hand the child off without blocking, and poll** — a stopped unit leaves no notification. Once its
output is unchanged for the silent-unit window, read `backlogrun-recovery.md` → "A delegated unit that
stopped without reporting" and ask `pnpm josh run:liveness`.

## Audit before the first child

Run `pnpm josh epic:audit <E>` before the first child; a run begun from a bare Issue audits when it
creates the epic. Errors stop the run; warnings are read and passed. Fixing a finding is Tier A.

## `josh latest` runs once per session, not once per child

Ask once, the first time the loop hands back a child number, before implementing it:

```bash
pnpm josh latest:scope   # → required | skip ; the reason on stderr
git stash push -u -m "backlogrun: josh latest #<N>"        # only if the tree has staged or modified files — never conditional on the answer
pnpm josh ms
pnpm josh latest         # on `required` only
pnpm josh stash:pop "backlogrun: josh latest #<N>"         # only if you stashed above — by message, not a positional pop
```

On `required`, load the `dependency-update` skill; `latest-gate.md` is the single source. A resumed
`backlogrun` asks again. **The lock file lands with the first child's `pnpm josh git -y`**; fix a
failing bump forward. **Never inside a lane** (`pnpm josh latest:guard` refuses) — the parent runs it
in the primary checkout (`backlogrun-lanes.md` → "Once per repository, before the first lane opens").

## Preflight — the child's claim asks it

`pnpm josh run:hold <N>`, the child's first call, checks for an interrupted run's leftovers before
claiming the tree and prints the step for each answer (`reclaim` / `resume` / `park`) on stderr —
follow it, and report a reclaim or resume with its stash reference (`docs/josh-commands-run.md` →
"`josh run:hold`").
