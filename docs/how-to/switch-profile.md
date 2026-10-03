# Switch a project's profile

## When to use it

A `basic` project has grown npm dependencies and you want the `full` toolchain — ESLint, type check, tests, Git hooks — or the other way round.

## Steps

1. See the current profile and why it was chosen with [`josh profile`](../josh-commands.md#josh-profile).
2. Re-run `josh init` with its profile option set to the one you want ([`josh init`](../josh-commands.md#josh-init)). The choice is recorded in `package.json`, and a later `josh init` keeps it.
3. Moving from `basic` to `full`: `josh init` skips AI files that already exist, so run [`josh sync`](../sync.md) to replace them with the `full` set, then delete two lines from `CLAUDE.md` — the basic-profile bootstrap note ("If kit is not installed, run pnpm install first.") and the `@node_modules/@joshuafolkken/kit/dist/CLAUDE.basic.md` import (`CLAUDE.static.md` in a project set up before the rename). Sync adds the `full` import but leaves your lines alone.
4. Run `josh gate`. `josh init` already ran `pnpm install` and `josh format`.

[Project profiles](../init.md#project-profiles) has the rules that pick a profile when none is recorded, and what each one sets up.

## Check it worked

- `josh profile` prints the new profile with the recorded value as its reason.
- `josh gate` runs the checks the new profile adds instead of skipping them.

## Common failures

- The profile does not change after adding dependencies: a recorded profile wins over detection, so pass the profile option explicitly.
- Files from the old profile remain after moving from `full` to `basic`: `josh init` removes nothing, so delete the `full` tooling you no longer want by hand and check with `josh gate`. `josh sync` follows the newly recorded profile, so it writes only the `basic` file set from then on.
