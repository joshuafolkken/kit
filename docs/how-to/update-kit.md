# Update kit

## When to use it

A new kit version is out and you want its updated AI rules, workflow templates and other managed files in your project.

## Steps

1. Check what you have and what is available with [`josh version`](../josh-commands.md#josh-version); its upgrade option moves both the global install and the project dependency.
2. Run [`josh sync`](../josh-commands.md#josh-sync) to pull in the managed files. [sync.md](../sync.md#what-gets-synced) lists what it overwrites and what it merges.
3. `package.json` is mostly left alone by sync. Re-running `josh init` adds scripts and development dependencies the new version introduced, but never overwrites ones that already exist ([what is not synced](../sync.md#what-does-not-get-synced), [init.md](../init.md)).
4. Run `pnpm install` so a rewritten `prepare` script takes effect, then `josh gate`.

## Check it worked

- `josh version` shows the project and global versions at the latest release, or a `Held:` line naming a release still inside the minimum-release-age window.
- `git diff` shows the managed files updated and nothing you own changed.

## Common failures

- A local edit to a managed file disappears: sync reverts it by design. Keep local settings in files kit does not manage ([troubleshooting.md](../troubleshooting.md#josh-sync-reports-config-drift)).
- `josh version` still reports a stale install: it prints a `Run:` line with the upgrade command for each target that is behind ([`josh version`](../josh-commands.md#josh-version)).
