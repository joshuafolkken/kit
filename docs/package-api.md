# Package API reference

For code that imports kit directly: the config presets and libraries `@joshuafolkken/kit` exports. Installing kit and running `josh init` are covered in [Set up the full profile](./setup/full.md).

## Config entry points

The package exposes config presets for direct import:

| Use                  | Reference                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| ESLint config        | `@joshuafolkken/kit/eslint/vanilla` (optional peers required)                                                                |
| ESLint base          | `@joshuafolkken/kit/eslint/base` — the rule set `vanilla` builds on                                                          |
| ESLint rule          | `@joshuafolkken/kit/eslint/test-filename` — the test-file name rule                                                          |
| Prettier             | `@joshuafolkken/kit/prettier` (needs the three plugins in [manual-config.md](./manual-config.md))                            |
| Prettier, no plugins | `@joshuafolkken/kit/prettier/basic` — what a `basic` project uses (`/prettier/static` is the same preset under its old name) |
| cspell               | `node_modules/@joshuafolkken/kit/cspell/index.yaml` (`@joshuafolkken/kit/cspell`)                                            |
| tsconfig             | `./node_modules/@joshuafolkken/kit/tsconfig/base.json`                                                                       |
| Scripts              | `tsx node_modules/@joshuafolkken/kit/scripts/gh/fix-gh-packages.ts`                                                          |
| Prompts              | `node_modules/@joshuafolkken/kit/prompts/*.md`                                                                               |
| Version library      | `@joshuafolkken/kit/version`                                                                                                 |
| Config-merge         | `@joshuafolkken/kit/config-merge`                                                                                            |
| Env flags            | `@joshuafolkken/kit/env`                                                                                                     |
| webServer cmd        | `@joshuafolkken/kit/web-server`                                                                                              |
| Dev / preview ports  | `@joshuafolkken/kit/ports` — the port pair derived from `PORT_SEED`                                                          |
| Self-sync guard      | `@joshuafolkken/kit/self-sync-guard` — see [sync.md](./sync.md#refused-inside-the-distribution-packages-own-repository)      |
| Managed marker       | `@joshuafolkken/kit/managed-marker` — see [sync.md](./sync.md#ai-files-overwritten)                                          |

Prefer wiring up individual configs without `josh init`? See [manual-config.md](./manual-config.md).

## Version-command library (`@joshuafolkken/kit/version`)

A package-name-parameterized implementation of the `version` (show) and `version --upgrade`
commands, so a consuming package (e.g. `@joshuafolkken/game-kit`, `@joshuafolkken/app-kit`) drives
both commands through kit instead of copying the scripts. Each consumer's thin CLI wrapper passes
only its own package name + GitHub Packages versions endpoint:

The version commands read the latest release (and the publish times behind a `Held:` line) from public npm, without credentials, so a consumer who installed from public npm needs no `read:packages` token. When `pnpm config get "@<scope>:registry"` points to GitHub Packages, or public npm does not answer for the package, they read its GitHub Packages versions endpoint through `gh api` as before. `josh latest` resolves dependency updates with pnpm using the registry configured by the current project; a new kit-only project uses public npm, while an existing project with a GitHub Packages scope mapping continues to use GitHub Packages.

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
// process.exit(version_commands.run_upgrade(config)) // version --upgrade
```

`create_version_command_config` derives the lockfile-repair (`fix-gh-packages`) path from the
package name. The optional `self_directory` enables the running-binary line; an optional
`resolve_warning` hook supplies a package-specific PATH-shadowing warning. The export resolves
compiled `.js` + `.d.ts` (built from `scripts/version/index.ts`), so consumers can keep
`@joshuafolkken/kit/version` **external** — node loads the `.js` at runtime and resolves `execa` /
`zod` from kit's own `node_modules` rather than bundling kit's transitive graph, while `tsc` reads
the bundled `.d.ts`. kit's own `version` / `version --upgrade` consume this same library via
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
`version --upgrade` runs, each stale effective install is re-read so an upgrade that advanced but still
trails `latest` (a minimum-release-age hold, say) is reported as an advance rather than silence.

## Config-merge library (`@joshuafolkken/kit/config-merge`)

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

## Env-flag library (`@joshuafolkken/kit/env`)

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

## webServer command library (`@joshuafolkken/kit/web-server`)

Builds the command the distributed `playwright.config.ts` hands its `webServer`: the named
`package.json` scripts run through `node --run` instead of `pnpm run`. pnpm 11.27.1+ moves a script
it runs without a terminal into its own process group, so Playwright's teardown signal reached pnpm
and not the server; `node --run` keeps the server in Playwright's group, so the default teardown
stops it with no relay in between. `node --run` does not run `pre<name>` hooks, so each script's
`pre` hook is chained in explicitly when the project defines one.

```ts
import { web_server } from '@joshuafolkken/kit/web-server'

web_server.script_command(['build', 'preview'])
// 'node --run build && node --run prepreview && node --run preview' when `prepreview` exists
```
