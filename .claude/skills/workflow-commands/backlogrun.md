# `backlogrun` — the manifest (named issues, epics and the opted-in backlog)

**`backlogrun` names either nothing, or the issues and epics to run first.** With no argument it runs
whatever `pnpm josh backlog:next` offers — the whole opted-in backlog, every issue carrying `auto-ok`
plus every child of an epic whose root carries it, ordered by dependency and grouped into waves. With
`#N1 #N2 …` it runs those named items in the order they were typed, one at a time, and **then** drains
that same backlog. **`--only` stops it after the named list**, draining nothing.

**The loop's current position is computed, not carried in the conversation.** `pnpm josh run:step <N>`
reads it from the event stream, the carry record and the issue state, and prints the next single
action — a runnable command, or the one point a person has to judge — followed by the section that
governs it. With no `<N>` it answers for the parent itself, from the carry record alone.

**A named item may be a single issue or an epic.** A single-issue item is one `fullrun`; **a named epic runs its children in
dependency order across the free lanes, and the run does not advance to the next named item until
every one of that epic's children has been processed — merged or parked.** `backlogrun #E --only`
therefore runs exactly one epic's children and stops.

## Explicit invocation required (MANDATORY)

**Never start a `backlogrun` unless the user has typed the keyword in the current turn's prompt** —
`SKILL.md` → "0. The rule that fires before any of them — explicit invocation"; a cut and resumed run
is still that one invocation (`backlogrun-steps.md` → "The session cut is inside the invocation").

## The manifest — the ordered flow

A section `run:step` prints is not fetched again. Every other one is read at its step with
`pnpm josh doc:section <file> "<heading>"` — never a whole document (`SKILL.md` → "A section
reference is read as a section").

1. **Claim nothing at the entry — this parent orchestrates and never implements.** The working-tree
   hold, the split assessment and `fullrun.md` are read by a dispatched child inside its own delegated
   `fullrun` unit, never at the parent's entry.
2. **Begin the carry record before the plan** — `pnpm josh run:carry --begin "<invocation>" --owner
   "$PPID"` and `pnpm josh run:wake --start`, in the same turn as the first `pnpm josh ms`. Its answers:
   `backlogrun-steps.md` → "The session cut is inside the invocation"; a resumed session:
   `backlogrun-progress.md` → "Resuming after a cut".
3. **What this invocation approves** — the opted-in pool, a run's own filings once bundled, and the
   brake that bounds the amount: `backlogrun-steps.md` → "What one invocation approves".
4. **Report the plan before the first child** — `pnpm josh backlog:plan`, then resolve every
   `needs-decision` issue decidable from its body in one pass, recording `blocked-by`, `run:solo` and
   `run:lane` in the same pass: `backlogrun-steps.md` → "The plan, before the first child starts";
   `run:solo`: `backlogrun-lanes.md` → "A solo run".
5. **Named issues run first, in order** — each as a delegated `fullrun`, one at a time, then the pool;
   `--only` stops after the list.
   - Once per session: `backlogrun-steps.md` → "What runs once per session, not once per issue" and
     `backlogrun-child.md` → "`josh latest` runs once per session, not once per child"
     (`latest-gate.md` whole on `required`).
   - The watcher: `progress-watcher.md` → "Progress while the run is quiet".
   - Lanes: `backlogrun-lanes.md` → "Once per repository, before the first lane opens", by hand
     `backlogrun-lanes.md` → "Opening one lane and dispatching its child".
   - Dispatch: `backlogrun-child.md` → "Each child runs in a delegated unit".
6. **The loop belongs to the supervisor — hand it over with what the bare `pnpm josh run:step`
   prints**, whatever the plan held: `run:wake` runs `backlog:drive`, which returns a branch to an AI
   session only when it needs judgment (`backlogrun-steps.md` → "The loop").
   - An `epic #N` hand-back or a `merge` branch: `backlogrun-progress.md` → "Running a named epic's
     children".
   - A merge answered `over`: `backlogrun-progress.md` → "The hand-off".
   - A unit gone silent: `backlogrun-recovery.md` → "A delegated unit that stopped without reporting".
   - A child that cannot finish: `backlogrun-park.md` → "park and continue".
7. **End the record when the run ends** — `run:report`, then `run:carry --end` (or `--end --stopped
   "<reason>"`) and `run:wake --stop`: `backlogrun-steps.md` → "End the record when the run ends".
   - An empty plan is not that end; the driver's idle watch decides it. A person stops a run from the
     terminal with `pnpm josh backlogrun --stop`, which makes both calls.
   - The last merge: `backlogrun-progress.md` → "Who sends the summary, and who propagates", then
     `followup.md` → "When `pnpm josh release` runs".

## Guards

| Guard | Limit | On reaching it |
| --- | --- | --- |
| Children per run | 30 | Stop and report; an epic this large should be split. |
| Issues filed per run | 10 | Stop and report; a run filing more than this has lost the plot. |
| Consecutive child failures | 3 | Stop and report; something is wrong with the environment, not the children. |

A failure that is not consecutive parks its child and the run continues.
