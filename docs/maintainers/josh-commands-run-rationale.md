# josh run, lane and session command reference — rationale and history

History behind [josh-commands-run.md](../josh-commands-run.md), kept here so the reference states
only each command's contract — what it does, its arguments, output, exit codes and side effects.

## `josh lane:dispatch` applies `in-progress` before it launches

Before the label moved to the dispatch, a lane counted as busy only once the child's own `fullrun`
reached its apply — a window that used to be tens of minutes, during which another session could
claim the same issue.

## `josh cost` and `josh time` lost their report scopes

`josh cost` once carried report scopes and a `--cap` threshold; both are retired, and the hand-off
aggregates they produced live in `josh time`. `josh time`'s additional report scopes
(`--issue` / `--session` / `--epic` / `--last` / `--period`) and the `--instructions` / `--top`
modifiers they carried were retired with no rule or decision reading them (joshuafolkken/kit#2017),
leaving the run tree as the only scope.

## `josh edit:files` is a command rather than advice

joshuafolkken/kit#2202 folded the pre-edit _reads_ (`josh read:files`) and left the edits to native
multiple `Edit` blocks, on the ground that presupposing a multi-edit tool would leave the rule unfired
where the harness lacks one. joshuafolkken/kit#2366 measured that bet across six lanes — **230 of 230
edit turns issued a single `Edit`**, a per-turn density of exactly 1.000 — so native multiple edits
never happened. A composite command is the only lever measured to move round-trip density
(joshuafolkken/kit#2165, joshuafolkken/kit#2162, joshuafolkken/kit#2202).

## `josh read:set` lists `pre-gate-cut.md` as a point-of-use read

`pre-gate-cut.md` joined the point-of-use list in joshuafolkken/kit#2289: it is the single source of
the pre-gate cut every implementing run and every dispatched lane child reaches, so its ~10k-token
read was a point-of-use read the count had silently omitted. The per-run dollar figure assumes the
measured mean run of the 2026-09-21 backlogrun (epic joshuafolkken/kit#2280).

## `josh run:next` and `josh run:prep`

`run:next` is the consumer joshuafolkken/kit#2165's `run:prep` was built to have, and the foundation
the entry-read trim of epic joshuafolkken/kit#2166 rests on.

## `josh run:cut` lost its setup-phase cut

The setup-phase `--setup` cut (joshuafolkken/kit#2346) was retired (joshuafolkken/kit#2489): a lane
child's context is bounded by the threshold-gated implementation cut alone.

## Where each command came from

The issues that introduced or reshaped each command, kept here so the reference carries no
provenance citations. Read an issue for the decision behind a behavior; the reference states only
the behavior. joshuafolkken/kit#3277 moved these commands out of the automation reference.

| Command                              | Issues                                                               |
| ------------------------------------ | -------------------------------------------------------------------- |
| `josh run:hold` / `josh run:release` | #2760, #2796, #3023                                                  |
| `josh run:carry`                     | #2136, #2342, #2492, #2760                                           |
| `josh run:cut`                       | #2346, #2354, #2382, #2484, #2489, #2760                             |
| `josh run:ending`                    | #2240                                                                |
| `josh run:entry`                     | #2372, #2760, #2796, #3023, #3042                                    |
| `josh run:status`                    | #2165                                                                |
| `josh run:next`                      | #2165, #2166, #2188                                                  |
| `josh run:prep`                      | #2165, #3154                                                         |
| `josh run:step`                      | #2248, #2297, #2370, #2653, #3154                                    |
| `josh run:merge`                     | #2024, #2240, #2484                                                  |
| `josh run:review`                    | #2179                                                                |
| `josh run:tail`                      | #2372, #2763, #2919, #2979                                           |
| `josh ship`                          | #2398, #2426, #2427, #2428, #2457, #2489, #2500, #2946, #2966, #3222 |
| `josh run:report`                    | #2249, #2393                                                         |
| `josh run:event`                     | #2205, #2207, #2492                                                  |
| `josh run:progress`                  | #2156, #3102                                                         |
| `josh run:board`                     | #3430                                                                |
| `josh cost`                          | #2406                                                                |
| `josh read:set`                      | #2021, #2256, #2280, #2289                                           |
| `josh doc:read`                      | #1797, #2188                                                         |
| `josh read:files`                    | #2202                                                                |
| `josh edit:files`                    | #2162, #2165, #2202, #2366, #2493                                    |
