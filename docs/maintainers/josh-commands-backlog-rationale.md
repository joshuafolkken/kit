# josh issue, epic, backlog and review command reference — rationale and history

History behind [josh-commands-backlog.md](../josh-commands-backlog.md), kept here so the reference
states only each command's contract — what it does, its arguments, output, exit codes and side effects.

## `josh delegate` no longer counts investigation reads

The investigation threshold's counting first lived beside the `josh delegate` enumeration; it moved
into `josh investigation:guard`, which is why a delegation resets the counter rather than spending it.

## Where each command came from

The issues that introduced or reshaped each command, kept here so the reference carries no
provenance citations. Read an issue for the decision behind a behavior; the reference states only
the behavior. joshuafolkken/kit#3280 moved these commands out of the automation reference.

| Command                | Issues                                   |
| ---------------------- | ---------------------------------------- |
| `josh issue:comment`   | #2304                                    |
| `josh pkg:scout`       | #2216                                    |
| `josh issue:lint`      | #2123, #2212, #2353                      |
| `josh defect:rate`     | #2449, #2455                             |
| `josh report:lint`     | #2123                                    |
| `josh stash:pop`       | #2050                                    |
| `josh epic:next`       | #2779                                    |
| `josh auto-ok:next`    | #2928                                    |
| `josh backlog:next`    | #2244, #2449, #2455, #2776, #2779, #2928 |
| `josh backlog:plan`    | #2778                                    |
| `josh backlog:stalled` | #2359                                    |
| `josh backlog:offer`   | #2335                                    |
| `josh backlog:drive`   | #2499, #2508, #2881                      |
| `josh oracle:list`     | #2324, #2334, #2808                      |
