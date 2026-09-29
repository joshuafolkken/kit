# Switch a project's profile

## When to use it

A `static` project has grown npm dependencies and you want the full `node` toolchain — ESLint, type check, tests, Git hooks — or the other way round.

## Steps

1. See the current profile and why it was chosen with [`josh profile`](../josh-commands.md#josh-profile).
2. Re-run `josh init` with its profile option set to the one you want ([`josh init`](../josh-commands.md#josh-init)). The choice is recorded in `package.json`, and a later `josh init` keeps it.
3. Run `pnpm install`, then `josh gate`.

[Project profiles](../init.md#project-profiles) has the rules that pick a profile when none is recorded, and what each one sets up.

## Check it worked

- `josh profile` prints the new profile with the recorded value as its reason.
- `josh gate` runs the checks the new profile adds instead of skipping them.

## Common failures

- The profile does not change after adding dependencies: a recorded profile wins over detection, so pass the profile option explicitly.
- Files from the old profile remain after moving from `node` to `static`: what happens to them is not documented; remove unwanted tooling by hand and check with `josh gate`.
