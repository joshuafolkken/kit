# The dependency update — when `josh latest` runs

`josh latest` updates every dependency, the published ranges, `pnpm audit` and pnpm, in that
order and over the network. This file is the **single source** of when it runs; every entry point
references it and none restates it. History: `docs/maintainers/latest-gate-rationale.md` → "Where
each rule came from".

## Ask the command; do not decide

```bash
pnpm josh latest:scope   # → required | skip ; the reason on stderr
```

**`required` means run it. `skip` means the update is already current and this run does not.**

**The input is when `josh latest` last finished in this checkout, and nothing else** — never a
judgement that the dependencies are probably still fresh.

- **No record answers `required`.** A fresh checkout, a cleared temp directory, a run that fell over
  halfway — every one of them lands there, and none of them is evidence that anything is current.
- **The record is written by `josh latest` itself**, as the last step of its chain, so a chain that
  failed leaves nothing behind and the next run updates again.
- **The window is 12 hours**, moved in either direction by `JOSH_LATEST_MAX_AGE_HOURS`. A value that
  is not a positive number falls back to the default rather than disabling the update.
- **The record is per checkout.** An epic that spans repositories updates each one on its own
  schedule.

## What runs when the answer is `required`

```bash
git stash push -u -m "josh latest"    # only if the working tree has staged or modified files
pnpm josh ms
pnpm josh latest     # on `required` only
pnpm josh stash:pop "josh latest"     # only if you stashed above — by message, never a positional pop
```

**The pop is by message, never a bare `git stash pop`** — the stash is a repository-wide stack every
work tree shares.

Then **load the `dependency-update` skill and follow its procedure** — the overrides in **both**
`pnpm-workspace.yaml` and `package.json`, and the one expected `devEngines` pnpm bump — in every run in
which `josh latest` actually ran; never report the pins intact without having run it.

**On `skip`, one line of that block goes away and no more.** `pnpm josh latest` does not run, and
the `dependency-update` skill is not read, because nothing rewrote a pin for it to check.

**Two of those steps are not this gate's, and making either conditional breaks something.**
`pnpm josh ms` runs per issue and per child either way — it brings the previous merge into the tree.
The stash before it is the branch switch's, not the update's, so it is conditional on the **tree**,
never on the answer.

## The vulnerability net is not what moved

`pnpm audit` runs inside `josh latest`, so a `skip` skips that reading too. **What still covers every
merge is CI**: the `Security Audit` job runs on every pull request and is one of the required checks
`pnpm josh followup` waits on.

## The lock file lands with the issue that ran the update

**The lock file the update rewrites lands with whichever issue ran it.** `josh latest` leaves
`pnpm-lock.yaml` modified and that issue's `pnpm josh git -y` commits it. Should the issue then fail
CI on a bump rather than on its own change, fix it forward before parking the issue for it. Rationale
for the elapsed-time window: `docs/maintainers/latest-gate-rationale.md` → "Why an elapsed-time
window rather than once per batch".

`docs/josh-commands-automation.md` documents the command itself.
