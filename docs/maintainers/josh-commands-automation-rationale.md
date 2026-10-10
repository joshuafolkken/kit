# josh automation command reference — rationale and history

History behind [josh-commands-automation.md](../josh-commands-automation.md), kept here so the
reference states only each command's contract — what it does, its arguments, output, exit codes and side effects.
The run, lane and session commands' history is in [josh-commands-run-rationale.md](josh-commands-run-rationale.md);
the issue, epic, backlog and review commands' history is in
[josh-commands-backlog-rationale.md](josh-commands-backlog-rationale.md).

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

## Where each command came from

The issues that introduced or reshaped each command, kept here so the reference carries no
provenance citations. Read an issue for the decision behind a behavior; the reference states only
the behavior.

| Command                     | Issues                                                           |
| --------------------------- | ---------------------------------------------------------------- |
| `josh batch:guard`          | #2138, #2164, #2178, #2276, #2405, #2984 (the hook launch shape) |
| `josh time:density`         | #2405                                                            |
| `josh investigation:guard`  | #2138, #2382                                                     |
| `josh duplicate-read:guard` | #2298                                                            |
| `josh rule:guard`           | #2297, #2385, #2807                                              |
| `josh pretool:guard`        | #2138, #2164, #2178, #2276, #2298, #2382, #2405                  |
| `josh stop:guard`           | #2121, #2247, #2422                                              |
| `josh followup`             | #2446, #2770, #3023                                              |
| `josh observations:flush`   | #2763, #2919                                                     |
| `josh measure:rerun`        | #2178, #3064                                                     |
| `josh review:record`        | #2325, #2343, #2419, #2919, #3645                                |
| `josh reserved-run`         | #2351                                                            |
| `josh repo:party`           | #2122                                                            |
