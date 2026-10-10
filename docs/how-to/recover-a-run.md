# Recover a stopped run

## When to use it

A workflow run stopped — on purpose, as `halfrun` does, or because a session ended — and you want to continue it or clean up after it.

## Steps

1. Look at the working tree first with `git status` and `git stash list`. Uncommitted work means a run still owns the tree.
2. To finish a `halfrun`, check the change, then type `fullrun #N` to the agent — or `prrun #N` to stop at a mergeable pull request. Either resumes the stopped run from the gate ([Run Issues with the workflow keywords](./run-issues.md)).
3. Without an agent, run the commit command the notification gave you instead of `fullrun #N` or `prrun #N`. A `needs-human-review` stop is finished with that command too.
4. If a new run answers `busy`, another run holds the tree ([`josh run:hold`](../josh-commands-run.md#josh-runhold--josh-runrelease)). Finish or stash that work; release a hold another run left behind, once you know that run has ended, with `josh run:release --force` (a plain `josh run:release` removes only your own run's hold). A hold over a clean tree expires after 8 hours.
5. Restore stashed work by its message with [`josh stash:pop`](../josh-commands-backlog.md#josh-stashpop), never a bare `git stash pop`.
6. For a `backlogrun` whose session was cut, [`josh run:carry`](../josh-commands-run.md#josh-runcarry) says whether it can resume; [`josh run:stranded`](../josh-commands-run.md#josh-runstranded) says whether a run is stuck with no session driving it.
7. Remove a stale `in-progress` label only once the tree is clean — a dirty tree means the hold is real. What each label and run state means is in [Labels and run states](../labels-and-run-states.md).

## Check it worked

- `git status` is clean or holds exactly the work you meant to keep, and [`josh run:step`](../josh-commands-run.md#josh-runstep) names the next action you expect.

## Common failures

- `josh stash:pop` answers `no-match` or `ambiguous`: the message did not pick out exactly one stash; list them and use the full message.
- A hold still answers `busy` after 8 hours: the tree is dirty, so it does not expire. Commit, stash or release the work first.
