# Recover a stopped run

## When to use it

A workflow run stopped — on purpose, as `halfrun` does, or because a session ended — and you want to continue it or clean up after it.

## Steps

1. Look at the working tree first with `git status` and `git stash list`. Uncommitted work means a run still owns the tree.
2. To finish a `halfrun` (or a `needs-human-review` stop), check the change, then run the commit command its notification gave you.
3. If a new run answers `busy`, another run holds the tree ([`josh run:hold`](../josh-commands-automation.md#josh-runhold--josh-runrelease)). Finish or stash that work; release a hold another run left behind, once you know that run has ended, with `josh run:release --force` (a plain `josh run:release` removes only your own run's hold). A hold over a clean tree expires after 8 hours.
4. Restore stashed work by its message with [`josh stash:pop`](../josh-commands-automation.md#josh-stashpop), never a bare `git stash pop`.
5. For a `backlogrun` whose session was cut, [`josh run:carry`](../josh-commands-automation.md#josh-runcarry) says whether it can resume; [`josh run:stranded`](../josh-commands-automation.md#josh-runstranded) says whether a run is stuck with no session driving it.
6. Remove a stale `in-progress` label only once the tree is clean — a dirty tree means the hold is real.

## Check it worked

- `git status` is clean or holds exactly the work you meant to keep, and [`josh run:step`](../josh-commands-automation.md#josh-runstep) names the next action you expect.

## Common failures

- `josh stash:pop` answers `no-match` or `ambiguous`: the message did not pick out exactly one stash; list them and use the full message.
- A hold still answers `busy` after 8 hours: the tree is dirty, so it does not expire. Commit, stash or release the work first.
