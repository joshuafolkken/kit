# `backlogrun` — the manifest (named issues, epics and the opted-in backlog)

**This file is the manifest, not the procedure** (joshuafolkken/kit#2190). It carries the ordered flow
as terse triggers and pointers; the fine print of each step is read on demand from
`backlogrun-steps.md`, its reference-only companion. `backlogrun-steps.md` is **not an entry read** —
it is classified point-of-use in `entry-read-set.ts`, exactly as the four `backlogrun-*.md` phase
documents are, so a `backlogrun` entry carries this manifest and nothing else up front
(joshuafolkken/kit#2010, joshuafolkken/kit#2190).

**`backlogrun` names either nothing, or the issues and epics to run first.** With no argument it runs
whatever `pnpm josh backlog:next` offers — the whole opted-in backlog, every issue carrying `auto-ok`
plus every child of an epic whose root carries it, ordered by dependency and grouped into waves. With
`#N1 #N2 …` it runs those named items in the order they were typed, one at a time, and **then** drains
that same backlog. **`--only` stops it after the named list**, draining nothing.

**The loop's current position is computed, not carried in the conversation.** `pnpm josh run:step <N>`
reads where the run is from the event stream, the carry record and the issue state, and prints the next
single action — a runnable command, or the one point a person has to judge — so a session cut, a
compaction or a fresh resume reaches the same next step from the same three inputs
(joshuafolkken/kit#2248).

**A named item may be a single issue or an epic** (joshuafolkken/kit#1985, folding in the old
`epicrun` keyword). A single-issue item is one `fullrun`; **a named epic runs its children in
dependency order across the free lanes, and the run does not advance to the next named item until
every one of that epic's children has been processed — merged or parked.** `backlogrun #E --only`
therefore runs exactly one epic's children and stops.

## Explicit invocation required (MANDATORY)

**Never start a `backlogrun` unless the user has typed the keyword in the current turn's prompt.**
This is the same rule the other entry points carry, at the same strength — `SKILL.md` → §0 is its
single source, and `CLAUDE.md` → "Explicit invocation required (MANDATORY)" is where it stays resident
so it binds on a turn where nothing here has been read. It matters more here than anywhere else,
because this is the entry point with the widest authorization: a conversational "clear the backlog" is
**not** an invocation, a confirmation question is no substitute for the keyword, and an earlier turn's
authorization does not carry.

**The keystroke starts the invocation; it does not have to land in every session that invocation
spans.** A `backlogrun` cut mid-run and resumed is still that one invocation
(`backlogrun-steps.md` → "The session cut is inside the invocation"). This reading covers `backlogrun`
and it alone — a `fullrun` cut still waits for the keyword.

## The manifest — the ordered flow

Each step is a terse trigger and a pointer; the procedure is read on demand from the section named.

1. **Claim nothing at the entry — this parent orchestrates and never implements.** The working-tree
   hold, the split assessment and `fullrun.md` are read by a dispatched child inside its own delegated
   `fullrun` unit (`backlogrun-child.md`), never at the parent's entry.
2. **Begin the carry record before the plan** — `pnpm josh run:carry --begin "<invocation>" --owner
   "$PPID"` and `pnpm josh run:wake --start`, in the same turn as the first `git switch main && git
   pull`. The answer table (`began` / `resumed` / `busy` / `standing` / `mismatch` / `expired` /
   `unreadable` / `unknown`) and the counting/hand-off/resume mechanism are
   `backlogrun-steps.md` → "The session cut is inside the invocation".
3. **What this invocation approves** — `backlogrun-steps.md` → "What one invocation approves": the
   opted-in pool, a run's own filings once bundled, and the brake (`--max`, ten filings, the WIP cap)
   that bounds the amount. `auto-ok` is a person's alone.
4. **Report the plan before the first child** — `pnpm josh backlog:plan`, then resolve every
   `needs-decision` issue decidable from its body in one pass. `backlogrun-steps.md` → "The plan,
   before the first child starts" and its "Resolve what the plan can resolve, before starting".
5. **Named issues run first, in order** — `backlogrun-steps.md` → "Named issues run first, in order":
   each a delegated `fullrun`, one at a time, then the pool drains; `--only` stops after the list.
6. **The loop** — `pnpm josh backlog:offer` is the loop's head; `backlogrun-steps.md` → "The loop"
   fixes the answer-to-word mapping, "The two budgets" the `run` / `watch` / `stop` verdict, "The cost
   check is not asked during a watch", and "Where the run stops" every termination.
7. **What runs once per session, not once per issue** — `backlogrun-steps.md` → "What runs once per
   session, not once per issue": the per-repository preflight, `josh latest` on `required`, the
   progress watcher, the carry/wake pair, and the release ask.
8. **End the record when the run ends** — `pnpm josh run:carry --end` (or `--end --stopped
   "<reason>"`) and `pnpm josh run:wake --stop`, in the same turn as the final report.

## Running a child — read the phase document at its point of use

Everything about *running one child* — of a named epic or of the opted-in pool — lives in four phase
documents, split out so the entry read carries only what binds before the first child
(joshuafolkken/kit#2010). **None of the four is an entry read.** Each is read in full, in the turn the
named step reaches it, exactly as `backlogrun-steps.md` and the shared gate documents
(`chain-rule.md` / `latest-gate.md` / `followup.md` / `background-commands.md`) are
(`SKILL.md` → §1, "Four documents are read at the point of use"):

| Read | In full, before | What it carries |
| --- | --- | --- |
| `backlogrun-child.md` | dispatching the first child (`pnpm josh delegate epic-child`, `pnpm josh lane:dispatch`) | the shared per-child `fullrun`, a bare non-epic `#N`, the delegated unit and its summary bound, liveness recovery, and the once-per-session setup (audit, `josh latest`, preflight) |
| `backlogrun-lanes.md` | opening the first lane (`pnpm josh lane:open`) | the per-repository lane ceiling and the lane lifecycle, and how a merge conflict is resolved |
| `backlogrun-progress.md` | starting the progress watcher (`pnpm josh run:progress --wait`) and the hand-off check at a merge (`pnpm josh cost --cut`) | the heartbeat, the hand-off and the cut/resume, waiting without waiting forever, and the end-of-run summary and propagate |
| `backlogrun-park.md` | a child cannot finish | park-and-continue, the `needs-human-review` stop, a stale `in-progress`, a prerequisite discovered mid-run, and a mid-run split |

## Guards

| Guard | Limit | On reaching it |
| --- | --- | --- |
| Children per run | 30 | Stop and report; an epic this large should be split. |
| Issues filed per run | 10 | Stop and report; a run filing more than this has lost the plot. |
| Consecutive child failures | 3 | Stop and report; something is wrong with the environment, not the children. |

A failure that is not consecutive parks its child and the run continues.

## This file is the single source of the `backlogrun` procedure

`CLAUDE.md` carries the keyword's row in the shorthand table and the explicit-invocation rule;
`SKILL.md` → §1 routes here. This manifest names which children there are and in what order; the
procedure for each step is `backlogrun-steps.md`, and *running one child* is the four phase documents
above. Where any of them could disagree, the rule is that this manifest and `backlogrun-steps.md` add
nothing to a child's procedure — they only say which children there are.
