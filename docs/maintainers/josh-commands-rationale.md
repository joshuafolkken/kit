# josh command reference — rationale and history

History behind [josh-commands.md](../josh-commands.md), kept here so the reference states only each
command's contract — what it does, its arguments, output, exit codes and side effects.

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
