# Change a rule kit distributes

## When to use it

In a project that uses kit, you want to change something kit ships — the AI rules in `CLAUDE.md`, a skill, `.claude/settings.json`, a workflow template.

## Steps

1. Check whether the file is overwritten by [`josh sync`](../josh-commands.md#josh-sync): [AI files](../sync.md#ai-files-overwritten) are replaced on every sync, while some [config files are merged](../sync.md#config-files-merged-only-when-already-present) and keep your entries.
2. For an overwritten file, do not edit it locally — the next sync reverts it. Propose the change to kit instead, as an Issue or pull request ([report it upstream](./report-upstream-bug.md)).
3. For a merged file, or a setting kit does not manage, edit your project's copy; [sync.md](../sync.md#what-does-not-get-synced) lists what sync leaves alone.
4. Once kit releases the change, [update kit](./update-kit.md) to pull it in.

## Check it worked

- After the next `josh sync`, `git diff` shows your change still in place — or arriving from kit.

## Common failures

- A local edit disappears after syncing: the file is one sync overwrites ([troubleshooting.md](../troubleshooting.md#josh-sync-reports-config-drift)).
- You want a project-only addition to the AI rules: kit has no separate local rules file for that yet, so propose it to kit.
