# Update dependencies

## When to use it

You want pnpm and every dependency on its latest version, with the security audit run and the project's deliberate pins left intact.

## Steps

1. Save the current pins with `josh overrides --save`, so there is a snapshot to compare against afterwards ([`josh overrides`](../josh-commands.md#josh-overrides)).
2. Run [`josh latest`](../josh-commands.md#josh-latest). It updates pnpm, updates the dependencies, then runs the audit; it never lowers a version, and restores the lockfile when an update would.
3. Confirm the pins survived. Effective `overrides` live in `pnpm-workspace.yaml`; pnpm 11 and 12 ignore `pnpm.overrides` in `package.json`, but inspect both files ([`josh overrides`](../josh-commands.md#josh-overrides)).
4. Check `devEngines` in `package.json`. The one expected change is `devEngines.packageManager.version` becoming identical to the new `packageManager` pin ([`josh latest:corepack`](../josh-commands.md#josh-latestcorepack)).
5. Run `josh gate`.

The agent-facing version of steps 3 and 4 is the [`dependency-update` skill](../../.claude/skills/dependency-update/SKILL.md).

## Check it worked

- The last overrides line of `josh latest` reads unchanged, and `git diff -- pnpm-workspace.yaml package.json` shows no override edits.
- `josh overrides` exits zero against the snapshot from step 1.

## Common failures

- A package did not move: held-back and overridden packages are skipped on purpose and listed in the output ([`josh latest:update`](../josh-commands.md#josh-latestupdate)).
- The audit fails because no scanner is installed: run [`josh audit:provision`](../josh-commands-automation.md#josh-auditprovision).
- A bump breaks the build: fix forward. Pin back only as a last resort, record why, and track the removal.
- The wrong Node or pnpm version is in use: [troubleshooting.md](../troubleshooting.md#wrong-node-or-pnpm-version).
