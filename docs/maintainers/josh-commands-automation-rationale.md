# josh automation command reference — rationale and history

History behind [josh-commands-automation.md](../josh-commands-automation.md), kept here so the
reference states only each command's contract — what it does, its arguments, output, exit codes and side effects.

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

## `josh delegate` no longer counts investigation reads

The investigation threshold's counting first lived beside the `josh delegate` enumeration; it moved
into `josh investigation:guard`, which is why a delegation resets the counter rather than spending it.

## The batching guard is off in a lane child

A _refusal_ ends a headless child's turn (joshuafolkken/kit#2138), so a lane child was given a
notice instead. joshuafolkken/kit#2178 took joshuafolkken/kit#2164's notice `off`;
joshuafolkken/kit#2276 restored it, naming concrete recent calls and recurring every single-call turn.
joshuafolkken/kit#2405's re-measurement read **1.13** calls per round trip (`josh time:density`, ten
most recent lanes) — below the 1.40 target and under the pre-restore baseline — so the notice was cut
off for good: a `PreToolUse` hook cannot see the turn it is in, so a notice is structurally unable to
reach the turn it would pack.

In the main line the guard once fired once per run and fell silent for the rest of a run that ignored
it; it now re-fires, the notice on a tighter interval than the refusal (joshuafolkken/kit#2276).

## The investigation guard is a notice in a lane child

It was `off` from joshuafolkken/kit#2138 to joshuafolkken/kit#2382, on the reason that a child cannot
dispatch a sub-unit to read its own edit targets. joshuafolkken/kit#2382 re-measured six lane
children each reading 4–17 unedited files, so the reading was there to send out, and the guard became
a notice naming those files. It is re-measured on the next backlogrun and redesigned rather than kept
if it misses the target.

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
the behavior.

| Command                              | Issues                                                           |
| ------------------------------------ | ---------------------------------------------------------------- |
| `josh batch:guard`                   | #2138, #2164, #2178, #2276, #2405, #2984 (the hook launch shape) |
| `josh time:density`                  | #2405                                                            |
| `josh investigation:guard`           | #2138, #2382                                                     |
| `josh duplicate-read:guard`          | #2298                                                            |
| `josh rule:guard`                    | #2297, #2385, #2807                                              |
| `josh pretool:guard`                 | #2138, #2164, #2178, #2276, #2298, #2382, #2405                  |
| `josh stop:guard`                    | #2121, #2247, #2422                                              |
| `josh followup`                      | #2446, #2770, #3023                                              |
| `josh observations:flush`            | #2763, #2919                                                     |
| `josh measure:rerun`                 | #2178, #3064                                                     |
| `josh review:record`                 | #2325, #2343, #2419, #2919                                       |
| `josh reserved-run`                  | #2351                                                            |
| `josh issue:comment`                 | #2304                                                            |
| `josh pkg:scout`                     | #2216                                                            |
| `josh issue:lint`                    | #2123, #2212, #2353                                              |
| `josh defect:rate`                   | #2449, #2455                                                     |
| `josh report:lint`                   | #2123                                                            |
| `josh stash:pop`                     | #2050                                                            |
| `josh epic:next`                     | #2779                                                            |
| `josh auto-ok:next`                  | #2928                                                            |
| `josh backlog:next`                  | #2244, #2449, #2455, #2776, #2779, #2928                         |
| `josh backlog:plan`                  | #2778                                                            |
| `josh backlog:stalled`               | #2359                                                            |
| `josh backlog:offer`                 | #2335                                                            |
| `josh backlog:drive`                 | #2499, #2508, #2881                                              |
| `josh oracle:list`                   | #2324, #2334, #2808                                              |
| `josh run:hold` / `josh run:release` | #2760, #2796, #3023                                              |
| `josh run:carry`                     | #2136, #2342, #2492, #2760                                       |
| `josh run:cut`                       | #2346, #2354, #2382, #2484, #2489, #2760                         |
| `josh run:ending`                    | #2240                                                            |
| `josh run:entry`                     | #2372, #2760, #2796, #3023, #3042                                |
| `josh run:status`                    | #2165                                                            |
| `josh run:next`                      | #2165, #2166, #2188                                              |
| `josh run:step`                      | #2248, #2297, #2370, #2653                                       |
| `josh repo:party`                    | #2122                                                            |
| `josh run:merge`                     | #2024, #2240, #2484                                              |
| `josh run:review`                    | #2179                                                            |
| `josh run:tail`                      | #2372, #2763, #2919, #2979                                       |
| `josh ship`                          | #2398, #2426, #2427, #2428, #2457, #2489, #2500, #2946, #2966    |
| `josh run:report`                    | #2249, #2393                                                     |
| `josh run:event`                     | #2205, #2207, #2492                                              |
| `josh run:progress`                  | #2156                                                            |
| `josh cost`                          | #2406                                                            |
| `josh read:set`                      | #2021, #2256, #2280, #2289                                       |
| `josh doc:read`                      | #1797, #2188                                                     |
| `josh read:files`                    | #2202                                                            |
| `josh edit:files`                    | #2162, #2165, #2202, #2366, #2493                                |
