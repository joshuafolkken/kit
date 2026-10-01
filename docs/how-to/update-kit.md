# Update kit

## When to use it

A new kit version is out and you want its updated AI rules, workflow templates and other managed files in your project.

## Steps

1. Check what you have and what is available with [`josh version`](../josh-commands.md#josh-version); its upgrade option moves both the global install and the project dependency.
2. Run [`josh sync`](../josh-commands.md#josh-sync) to pull in the managed files — in a `full` project only. A `basic` project skips this step: its `CLAUDE.md` imports the rules from the installed package, so upgrading the package is enough, and `josh sync` would apply the `full` file set ([#2827](https://github.com/joshuafolkken/kit/issues/2827)). [sync.md](../sync.md#what-gets-synced) lists what it overwrites and what it merges.
3. `package.json` is mostly left alone by sync. Re-running `josh init` adds scripts and development dependencies the new version introduced, but never overwrites ones that already exist ([what is not synced](../sync.md#what-does-not-get-synced), [init.md](../init.md)).
4. Run `pnpm install` so a rewritten `prepare` script takes effect, then `josh gate`.

## Check it worked

- `josh version` shows the project and global versions at the latest release, or a `Held:` line naming a release still inside the minimum-release-age window.
- `git diff` shows the managed files updated and nothing you own changed.

## Common failures

- A local edit to a managed file disappears: sync reverts it by design. Keep local settings in files kit does not manage ([troubleshooting.md](../troubleshooting.md#josh-sync-reports-config-drift)).
- `eslint` or one of its plugins is not found after upgrading from a kit that bundled them: kit now declares them as optional peers, so the project installs them. Re-run `josh init`, which adds every missing one at the version kit supports ([init.md → Dependencies](../init.md#dependencies)). If `eslint_d` was in use, add it to the project yourself; without it the edit hook falls back to the project's ESLint.
- `.svelte` files stop formatting: kit no longer brings Svelte in. Add `prettier-plugin-svelte` and `svelte` to the project ([manual-config.md](../manual-config.md)).
- `josh version` still reports a stale install: it prints a `Run:` line with the upgrade command for each target that is behind ([`josh version`](../josh-commands.md#josh-version)).
