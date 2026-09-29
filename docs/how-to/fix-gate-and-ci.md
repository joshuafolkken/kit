# Fix a failing gate or CI

## When to use it

`josh gate` reports a failure locally, or a pull request's CI checks are red.

## Steps

1. Read the gate's closing lines: one line per failed check, each with the command that re-runs it alone ([`josh gate`](../josh-commands.md#josh-gate)).
2. Fix, then re-run only the failing check — [`josh lint:related`](../josh-commands.md#josh-lintrelated), [`josh test:related`](../josh-commands.md#josh-testrelated) or [`josh cspell:dot`](../josh-commands.md#josh-cspelldot). A legitimate word the spell check flags goes in `cspell.config.yaml`.
3. Run `josh gate` once more. It refuses to start until `josh lint:related` and `josh test:related` have both passed on the current tree.
4. For CI, push the fix; [`josh followup`](../josh-commands.md#josh-followup) waits for the checks and names the first one that fails.

## Check it worked

- `josh gate` exits zero; `josh followup` reports every check green.

## Common failures

- The gate reuses an earlier green result: it records green trees, so a change it cannot see needs its force option ([`josh gate`](../josh-commands.md#josh-gate)).
- An E2E job fails in CI only: see [troubleshooting.md](../troubleshooting.md#ci-warns-that-the-playwright-image-could-not-be-resolved) and [`josh e2e:retry-check`](../josh-commands.md#josh-e2eretry-check).
- `josh followup` ends on its first poll: the pull request has a merge conflict to resolve.
- The failure comes from a dependency or another repository: do not loosen the check — [report it upstream](./report-upstream-bug.md).
