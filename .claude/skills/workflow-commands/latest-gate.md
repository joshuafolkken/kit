# The dependency update — when `josh latest` runs

`josh latest` updates every dependency, the published ranges, `pnpm audit` and pnpm, in that
order and over the network.

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
pnpm josh latest:if-required   # stash → josh latest → pop by message; nothing on `skip`
```

It asks `latest:scope` itself, so a run reads `run:prep`'s `latest:` line and never asks again. A
failed update or a conflicted pop stops with the stash kept and names the pop to run.

Then **load the `dependency-update` skill and follow its procedure** — the overrides in **both**
`pnpm-workspace.yaml` and `package.json`, and the one expected `devEngines` pnpm bump — in every run in
which `josh latest` actually ran; never report the pins intact without having run it.

**On `skip`, the command does nothing** and the `dependency-update` skill is not read, because
nothing rewrote a pin for it to check.

**`pnpm josh ms` is not this gate's** — it runs per issue and per child either way, bringing the
previous merge into the tree, before the update.

## The vulnerability net is not what moved

`pnpm audit` runs inside `josh latest`, so a `skip` skips that reading too. **What still covers every
merge is CI**: the `Security Audit` job runs on every pull request and is one of the required checks
`pnpm josh followup` waits on.

## The lock file lands with the issue that ran the update

**The lock file the update rewrites lands with whichever issue ran it.** `josh latest` leaves
`pnpm-lock.yaml` modified and that issue's `pnpm josh git -y` commits it. Should the issue then fail
CI on a bump rather than on its own change, fix it forward before parking the issue for it.

`docs/josh-commands-automation.md` documents the command itself.
