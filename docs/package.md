# Use the kit as a project package

Add `@joshuafolkken/kit` as a devDependency so a project can consume its ESLint / Prettier / tsconfig configs, prompts, and scripts, and run `josh init` to wire them up.

This is independent of the [global `josh` CLI](./cli.md) — most projects want both, but the package alone is enough to consume configs.

## 1. Authenticate

One-time GitHub Packages setup — see [authentication.md](./authentication.md). For a project dependency, the token line goes in your `~/.npmrc` and only the scoped registry mapping goes in the repo's `./.npmrc` (safe to commit — it holds no credential).

## 2. Install

```bash
pnpm add -D @joshuafolkken/kit
```

## 3. Initialize

Run once after installing — creates or merges all config files:

```bash
pnpm exec josh init
```

See [init.md](./init.md) for the full list of managed files. After upgrading the package, pull in updated AI files, workflow templates, and other managed files with:

```bash
pnpm exec josh sync
```

See [sync.md](./sync.md) for what `sync` overwrites and why. A project-local `josh` is available via `pnpm josh …` after installation, so the CLI works even without the global install.

## 4. Config entry points

The package exposes config presets for direct import:

| Use             | Reference                                                        |
| --------------- | ---------------------------------------------------------------- |
| ESLint config   | `@joshuafolkken/kit/eslint/vanilla`                              |
| Prettier        | `@joshuafolkken/kit/prettier`                                    |
| tsconfig        | `./node_modules/@joshuafolkken/kit/tsconfig/base.json`           |
| Scripts         | `tsx node_modules/@joshuafolkken/kit/scripts/fix-gh-packages.ts` |
| Prompts         | `node_modules/@joshuafolkken/kit/prompts/*.md`                   |
| Version library | `@joshuafolkken/kit/version`                                     |
| Config-merge    | `@joshuafolkken/kit/config-merge`                                |
| Env flags       | `@joshuafolkken/kit/env`                                         |

Prefer wiring up individual configs without `josh init`? See [manual-config.md](./manual-config.md).

### Version-command library (`@joshuafolkken/kit/version`)

A package-name-parameterized implementation of the `version` (show) and `version:upgrade`
commands, so a consuming package (e.g. `@joshuafolkken/game-kit`, `@joshuafolkken/app-kit`) drives
both commands through kit instead of copying the scripts. Each consumer's thin CLI wrapper passes
only its own package name + GitHub Packages versions endpoint:

```ts
// scripts/version/version-check.ts (consumer)
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { create_version_command_config, version_commands } from '@joshuafolkken/kit/version'

const config = create_version_command_config({
	package_name: '@joshuafolkken/game-kit',
	versions_endpoint: '/users/joshuafolkken/packages/npm/game-kit/versions?per_page=1',
	self_directory: path.dirname(fileURLToPath(import.meta.url)),
})

version_commands.run_check(config) // version (show)
// process.exit(version_commands.run_upgrade(config)) // version:upgrade
```

`create_version_command_config` derives the lockfile-repair (`fix-gh-packages`) path from the
package name. The optional `self_directory` enables the running-binary line; an optional
`resolve_warning` hook supplies a package-specific PATH-shadowing warning. The export resolves
compiled `.js` + `.d.ts` (built from `scripts/version/index.ts`), so consumers can keep
`@joshuafolkken/kit/version` **external** — node loads the `.js` at runtime and resolves `execa` /
`zod` from kit's own `node_modules` rather than bundling kit's transitive graph, while `tsc` reads
the bundled `.d.ts`. kit's own `version` / `version:upgrade` consume this same library via
[`scripts/version/kit-version-config.ts`](https://github.com/joshuafolkken/kit/blob/main/scripts/version/kit-version-config.ts).

The library also exports `resolve_effective_upstream_version(base_url, package_name, options?)`, the
single-sourced primitive for the effective-install hooks: it resolves an upstream package relative to
a base module URL via `createRequire`, walks up to that package's root (matching by `name`), and
returns its declared `version` — or `undefined`, never throwing, when the package is absent. A
downstream (e.g. app-kit resolving the kit bundled in the running global install) supplies its
`resolve_effective_version` hook with `resolve_effective_upstream_version(import.meta.url, upstream)`
instead of re-cloning the resolution walk. Pass `options.resolve_marker` (a subpath specifier) when
the package root is not directly `require.resolve`-able because its `package.json` is not in
`exports` — kit itself needs `{ resolve_marker: '@joshuafolkken/kit/config-merge' }`.

Both effective-install hooks receive an `UpstreamHookContext` — `{ latest, upstream_latest }` — so a
hook never resolves a version kit already fetched. `latest` is the downstream (main) package's own
latest, so a `resolve_global_upgrade_command` that emits `pnpm add -g @joshuafolkken/app-kit@<latest>`
reuses kit's single fetch; `upstream_latest` is _that upstream's_ own latest, the version kit measures
the effective install against, so a hook can name the version it was just reported stale for.

A stale effective install whose global command provably cannot fix it is reported as an explanation
rather than a dead `Run:` hint. Kit only makes that claim when the consumer declares the command
pin-only via `is_global_upgrade_command_pinned: true` on the upstream descriptor: kit then treats the
command as a no-op once every version it pins is already installed. Leave the flag unset for a command
that forces a fresh resolve (e.g. `pnpm remove -g <pkg> && pnpm add -g <pkg>@<latest>`) — such a
command changes the resolved graph even when its pin matches what is installed, and must never be
suppressed. Identical upgrade commands returned by several upstreams are emitted once, and after
`version:upgrade` runs, each stale effective install is re-read so an upgrade that advanced but still
trails `latest` (a minimum-release-age hold, say) is reported as an advance rather than silence.

### Config-merge library (`@joshuafolkken/kit/config-merge`)

A parameterized, idempotent patcher for one list field of a config file — the cspell `import`
list (YAML) and the tsconfig `extends` list (JSON). It exposes first-class **ensure** + **remove**
semantics so a consuming package (e.g. `@joshuafolkken/app-kit`) can own its own lines without
copying kit's merge logic: ensure entries are prepended, remove entries are dropped by exact
string or pattern match, and every other key, value, and ordering is preserved.

```ts
import { config_merge } from '@joshuafolkken/kit/config-merge'

// cspell.config.yaml: drop any kit `*/sveltekit` import, ensure the app-kit one, keep `words`.
const patched_yaml = config_merge.patch_yaml_list_field(existing_yaml, {
	field: 'import',
	ensure: ['@joshuafolkken/app-kit/cspell/sveltekit'],
	remove: [/@joshuafolkken\/kit\/.*\/sveltekit$/u],
	position: { after: 'version' },
	quote_style: 'double',
})

// tsconfig.json: same ownership swap on the `extends` list.
const patched_json = config_merge.patch_json_list_field(existing_json, {
	field: 'extends',
	ensure: ['@joshuafolkken/app-kit/tsconfig/sveltekit'],
	remove: [/@joshuafolkken\/kit\/.*\/sveltekit$/u],
})
```

`patch_yaml_list_field` / `patch_json_list_field` return the input unchanged when nothing is
added or removed, so re-runs are no-ops. `read_yaml_list_field` reads a YAML list field for a
caller's own pre-checks. **Comments are not preserved in this first cut** — the patch round-trips
keys/values (the same value-only behavior `josh sync` already had); a comment-preserving migration
is deferred. The export resolves compiled `.js` + `.d.ts` (built from `scripts/config-merge/index.ts`),
so consumers keep `@joshuafolkken/kit/config-merge` **external** — `js-yaml` / `zod` resolve from
kit's own `node_modules`. kit's own `josh sync` / `josh init` consume this same library via
[`scripts/init/init-logic-yaml-merge.ts`](https://github.com/joshuafolkken/kit/blob/main/scripts/init/init-logic-yaml-merge.ts)
and [`scripts/init/init-logic-json-merge.ts`](https://github.com/joshuafolkken/kit/blob/main/scripts/init/init-logic-json-merge.ts).

### Env-flag library (`@joshuafolkken/kit/env`)

The single source for "is this env var switched on?" — the vocabulary the distributed
`playwright.config.ts` reads `PLAYWRIGHT_REUSE_SERVER` and `CI` with. Import it instead of
declaring your own truthy set in a config file: a local clone drifts immediately (the motivating
case accepted only `'1'`/`'true'`, so `ANALYZE=yes` silently did nothing in the same repository
where `PLAYWRIGHT_REUSE_SERVER=yes` worked).

```ts
import { environment_flags } from '@joshuafolkken/kit/env'

// Opt-in flag: only affirmative spellings enable — '1' / 'true' / 'yes' / 'on',
// case- and whitespace-insensitive. '0', 'false', empty and unset all read as off.
const is_analyze_enabled = environment_flags.is_flag_enabled(process.env['ANALYZE'])

// CI detection is the inverse: any non-empty value counts as CI (Woodpecker exports
// CI=woodpecker) except the explicit negatives '0' / 'false' / 'no' / 'off'.
const is_ci = environment_flags.is_ci_enabled(process.env['CI'])
```

`environment_flags.normalize_flag_value(value)` (trim + lowercase) is there for callers that extend the
vocabulary with their own comparisons. The module is plain committed JavaScript with a
hand-written `.d.ts` — like `./ports`, it must resolve on a fresh clone before any build, because
`playwright.config.ts` imports it.

## Next

- Full command reference: [josh-commands.md](./josh-commands.md).
- Want `josh` available everywhere? Install the [global CLI](./cli.md).
- Hitting an error? See [troubleshooting.md](./troubleshooting.md).
