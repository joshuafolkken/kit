# The dependency update — when `josh latest` runs

`josh latest` updates corepack, every dependency, the published ranges and `pnpm audit`, in that
order and over the network. Until joshuafolkken/kit#1215 every entry point put it at the head of
every run and called it **mandatory, never skip** — so a standalone `fullrun` paid 60–120 seconds
for it before touching the issue, and a batch that ran ten children paid it ten times unless the
entry's own file happened to hoist it by hand. This file is that rule's **single source**; every
entry point references it and none restates it.

## Ask the command; do not decide

```bash
pnpm josh latest:scope   # → required | skip ; the reason on stderr
```

**`required` means run it. `skip` means the update is already current and this run does not.**

**The input is when `josh latest` last finished in this checkout, and nothing else.** "The
dependencies are probably still fresh" is a judgement made under time pressure, and time pressure
resolves it toward `skip` exactly when a stale dependency is most likely to matter — the same reason
`pnpm josh review:level` took the review level out of an agent's hands and `pnpm josh eval:scope`
took the measurement trigger out of them.

- **No record answers `required`.** A fresh checkout, a cleared temp directory, a run that fell over
  halfway — every one of them lands there, and none of them is evidence that anything is current.
- **The record is written by `josh latest` itself**, as the last step of its chain, so a chain that
  failed leaves nothing behind and the next run updates again.
- **The window is 12 hours**, moved in either direction by `JOSH_LATEST_MAX_AGE_HOURS`. A value that
  is not a positive number falls back to the default rather than disabling the update.
- **The record is per checkout.** An epic that spans repositories therefore updates each one on its
  own schedule, which is what the old "once per session, not once per run" wording was reaching for.

## What runs when the answer is `required`

```bash
git stash push -u    # only if the working tree has staged or modified files
git switch main && git pull
pnpm josh latest     # on `required` only
git stash pop        # only if you stashed above
```

Then **load the `dependency-update` skill and follow its procedure** — the overrides in **both**
`pnpm-workspace.yaml` and `package.json`, and the one expected `devEngines` pnpm bump. That condition
is unchanged and unconditional: it applies to every run in which `josh latest` actually ran, and
never reports the pins intact without having been run.

**On `skip`, one line of that block goes away and no more.** `pnpm josh latest` does not run, and
the `dependency-update` skill is not read, because nothing rewrote a pin for it to check.

**Two of those steps are not this gate's, and making either conditional breaks something.**
`git switch main && git pull` runs per issue and per child either way: it is what brings the previous
merge into the tree, and an issue that skips it starts implementing on a stale default branch. The
stash before it is the branch switch's, not the update's — a dirty tree stops `git switch` whatever
this command answered — so it is conditional on the **tree**, never on the answer.

## The vulnerability net is not what moved

`pnpm audit` runs inside `josh latest`, so a `skip` skips that reading too. **What still covers every
merge is CI**: the `Security Audit` job runs on every pull request and is one of the required checks
`pnpm josh followup --merge` waits on, so nothing reaches the default branch without a fresh audit —
whatever this gate answered locally. The local reading is a head start on a failure CI would catch
anyway; it was never the only net.

## Why an elapsed-time window rather than "once per batch"

`queue` and `epicrun` had already hoisted the update to the head of a batch, and that hoist is
correct — but it says nothing about a standalone `fullrun`, which **is** the head of its own
one-issue batch and therefore updated on every invocation. A session that runs six issues one at a
time paid the full cost six times while a `queue` of the same six paid it once, for no difference
anybody chose. An elapsed-time window is the one condition that reads the same at every entry point,
so no entry needs a rule of its own — and the batch hoists survive it unchanged, because a batch's
second child asks the same command and is told `skip`.

**The lock file the update rewrites still lands with whichever issue ran it.** `josh latest` leaves
`pnpm-lock.yaml` modified and that issue's `pnpm josh git -y` commits it, exactly as before. What the
window removes is the other runs carrying the same bumps; it does not make that one diff clean.
Should the issue then fail CI on a bump rather than on its own change, that is a dependency problem
found once — fix it forward before parking the issue for it.

This file is the single source of the rule. `fullrun.md`, `halfrun.md`, `queue.md` and `epicrun.md`
each name `pnpm josh latest:scope` at the point their procedure reaches it and route here for
everything else; `docs/josh-commands.md` documents the command itself.
