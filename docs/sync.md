# josh sync — Detailed Behavior

`josh sync` overwrites managed files in your project with the latest versions from the installed `@joshuafolkken/kit` package. Run it after upgrading the package.

```bash
pnpm josh sync
```

Unlike `josh init` (which skips existing files), `josh sync` is designed for keeping managed files up to date. Most managed files are overwritten; `pnpm-workspace.yaml` is merged (see below).

## What gets synced

### AI files (overwritten)

These files are copied verbatim from the package, with one path transformation applied (see below):

```text
CLAUDE.md           AGENTS.md           GEMINI.md
CODE_OF_CONDUCT.md
.cursorrules        .coderabbit.yaml    .gitattributes
.mcp.json           .ncurc.json         .prettierignore
SECURITY.md         tsconfig.sonar.json
.github/workflows/ci.yml
.github/workflows/auto-tag.yml
.github/workflows/dependabot-auto-merge.yml
.github/workflows/production.yml
.github/workflows/sonar-qube.yml
.github/pull_request_template.md
.github/release.yml
.github/dependabot.yml
.claude/settings.json
```

> **GitHub Actions workflows are single-sourced by the kit.** Every consumer-facing workflow
> (`ci.yml`, `auto-tag.yml`, `production.yml`, `sonar-qube.yml`) is overwritten on
> each `josh sync`, so action SHA pins are bumped once in the kit and propagated to all consumers —
> no per-consumer maintenance. The kit's own `github-actions` Dependabot is what bumps those pins at
> the source; `josh sync` then distributes them. The `github-actions` entry in the distributed
> `dependabot.yml` is intentionally kept as a backstop (it covers any non-kit workflow a consumer
> adds, and finds nothing to bump for synced workflows since their pins are already current).
>
> **The `npm` entry, by contrast, no longer opens routine version-update PRs in any consumer.**
> It sets `open-pull-requests-limit: 0`, which disables version updates only. `josh latest` runs
> at the start of every `fullrun` / `halfrun` / `queue` and already bumps npm dependencies to
> latest, so the weekly Dependabot PRs were duplicating it — in kit they were closed unmerged
> after each had consumed a full CI run, and the same noise was replicated in every consumer that
> synced the file. Security advisories are unaffected — GitHub's Dependabot options reference
> states that security update pull requests "are not subject to this limit and do not count toward
> it" — so an advisory still opens an npm PR, provided the consumer has Dependabot security updates
> enabled. This reaches a consumer on its next `josh sync`. See joshuafolkken/kit#803.
>
> **`josh init`, `josh sync` and `josh doctor` all report that prerequisite.** Because the advisory path is now
> the only npm Dependabot path, a consumer whose `Dependabot security updates` setting is off
> receives no npm PRs at all — and the absence of a PR is indistinguishable from the absence of an
> advisory. All three query `GET /repos/{owner}/{repo}/automated-security-fixes` and print one
> of four results: `enabled`, `paused` (on, but opening no PRs), `disabled`, or `could not be read`.
> `sync` reports unconditionally, because it overwrites the file on every run. `init` and `doctor`
> report only where kit's config is actually present: `init` skips the file when the consumer
> already has its own, and `doctor` is routinely run from a home directory or an unrelated clone to
> diagnose the global install. Past that gate both always report, so a broken `gh` surfaces as
> `could not be read` instead of as silence.
> The last is reported as unchecked rather than as off — a 404 or a token without the scope is not
> evidence that the setting is disabled — and never fails the command. When the setting is **off**
> the report prints the enabling command, addressed at the resolved repository; kit does not run it,
> because changing a repository setting is the maintainer's call. A **paused** repository gets
> different advice: it is already `enabled: true`, so the enable endpoint is a no-op there — it must
> be resumed from the repository's Security → Dependabot page instead. See joshuafolkken/kit#805.
>
> **The workflow that merges the github-actions PRs is distributed too.**
> `.github/workflows/dependabot-auto-merge.yml` is the other half of `dependabot.yml`: without it a
> consumer receives the machinery that _opens_ Dependabot pull requests and none of the machinery
> that _closes_ them. That is the state joshuafolkken/app-kit#184 was found in — all checks green,
> `mergeable: MERGEABLE`, and no `autoMergeRequest` on the pull request, because nothing in the
> repository ever enabled auto-merge. It merges `github-actions` **patch and minor** bumps only, and
> never an npm bump at any semver level: the npm entry above leaves security advisories as the only
> npm pull request that can reach it, and an advisory is exactly the kind a human should read.
>
> **It merges a bump only in a workflow the consumer owns.** A bump to one of the workflows kit
> distributes (`ci.yml`, `auto-tag.yml`, `dependabot-auto-merge.yml`, `production.yml`,
> `sonar-qube.yml`) is left open instead, because the next `josh sync` rewrites those pins from the
> installed kit package regardless of what was merged. Merging one produces a loop — Dependabot
> bumps the pin, the workflow merges it, `josh sync` writes it back, Dependabot proposes the same
> bump again — with a full CI run on every round. kit 1.93.0 shipped the workflow without this
> exclusion; joshuafolkken/kit#836 added it. The pins in those files are maintained at the source:
> kit's own Dependabot bumps them and `josh sync` distributes the result. `deploy-vps.yml` is **not**
> on that list — sync patches its pnpm version but never touches its `uses:` pins, so a bump there is
> a real update and merges like any other consumer-owned workflow. The exclusion list travels inside
> the distributed workflow, and a kit unit test compares it against kit's own distribution lists, so
> it cannot drift from the set of files sync actually overwrites. See joshuafolkken/kit#802 for the
> ecosystem gate, joshuafolkken/kit#834 for the distribution, and joshuafolkken/kit#836 for the
> exclusion.
>
> In kit's **own** repository the same workflow deliberately has no such exclusion: there
> `.github/workflows/*` is the source of truth, so a bump merged in kit is precisely the update every
> consumer then receives.
>
> **`josh init`, `josh sync` and `josh doctor` report that workflow's prerequisite too.**
> `gh pr merge --auto` fails outright with `Auto-merge is not allowed for this repository` unless the
> repository's own **Allow auto-merge** setting is on, and that setting is off by default — so
> distributing the workflow without reporting the setting would hand every consumer a workflow that
> never merges anything. All three read the `allow_auto_merge` field of
> `GET /repos/{owner}/{repo}` and print one of three results: `enabled`, `disabled`, or
> `could not be read`. The whole repository object is requested rather than a `--jq` projection,
> because a projection cannot tell a field that is `false` from a field the response never carried —
> a token without admin access simply does not receive it. `sync` reports unconditionally; `init` and
> `doctor` report only where a workflow that calls `gh pr merge --auto` is actually present, which
> also covers a consumer's own auto-merge workflow, since it needs the same setting. When the setting
> is **off** the report prints the enabling command, addressed at the resolved repository. kit never
> runs it: changing a repository setting is outward-facing, needs admin scope, and is the
> maintainer's call — the same line joshuafolkken/kit#805 drew, which is why `josh doctor --fix` does
> not enable this either. See joshuafolkken/kit#834.
>
> **Pins are resolved when the file is written, not read from the template.** Every workflow the
> kit writes into a consumer (`josh init` and `josh sync` alike) passes through
> `workflow_pin_logic.apply_pins_for_destination`, which substitutes each `uses:` ref from the
> kit's own `.github/workflows/*` — the single source of truth. Dependabot's `github-actions`
> ecosystem can only scan `.github/workflows/**` and a root `action.yml`, so it can never update
> `templates/workflows/*`; resolving at write time is what keeps that blind spot from reaching
> consumers. A template ref that lags behind a bump is therefore harmless, and no longer fails the
> kit's own CI. See joshuafolkken/kit#747.

### `pnpm-workspace.yaml` (merged)

`pnpm-workspace.yaml` is **merged**, not overwritten. Your existing file is the base: all top-level keys it already has (user-added keys like `packages:`, and any value you already set on a managed key) are preserved as-is. Kit-managed keys the template introduces (`minimumReleaseAgeExclude`, `allowBuilds`, `overrides`, `trustLockfile`) are appended only when missing.

`trustLockfile: true` skips pnpm 11.5's install-time supply-chain re-verification of the committed lockfile. Without it, clean CI environments (e.g. Cloudflare Workers Builds) that cannot authenticate private `@joshuafolkken/*` GitHub Packages hit a false `ERR_PNPM_TARBALL_URL_MISMATCH`. `minimum-release-age` still applies at resolution time, so age-based supply-chain protection is preserved.

### File mappings (overwritten if source exists)

These are fully-managed files whose package source has a different name than the destination. They are byte-copied on every sync (consumers do not hand-edit them):

| Package source                                  | Destination                                   |
| ----------------------------------------------- | --------------------------------------------- |
| `templates/workflows/ci.yml`                    | `.github/workflows/ci.yml`                    |
| `templates/workflows/dependabot-auto-merge.yml` | `.github/workflows/dependabot-auto-merge.yml` |

If the source file does not exist in the installed package, the destination is skipped with a warning.

> `.gitignore` used to be a byte-copy mapping here, which wiped project-local entries on every sync. It is now **union-merged** instead — see the merged-config table below.

### `sonar-project.properties` (regenerated)

The Sonar config is regenerated from the current GitHub repo name (fetched via `gh repo view`). If `gh` is unavailable or the repo cannot be identified, this file is skipped with a warning.

The project key and organization are derived from the `owner/repo` slug:

- `project_key` → `owner_repo` (slash replaced with underscore, lowercased)
- `organization` → `owner` (lowercased)

### Config files (merged, only when already present)

These files are created by `josh init`. `josh sync` refreshes them in place by reusing the same merge functions `init` uses — never created on first run, so projects that opted out stay opted out. Each handler is idempotent: when the file is already current, it logs `unchanged` and skips the write.

`.secretlintrc.json` is the one exception: it **is** created when missing, because the pre-commit secret scan it configures ships to every consumer through `lefthook/base.yml` and cannot run without it. There is no opt-out to preserve — a project that predates the rule simply has no such file yet.

| File                      | Merge strategy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitignore`              | Append any missing kit ignore patterns; consumer-local entries are preserved. Matching is per-line and comments/blank lines are skipped, so re-running is a no-op                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `.npmrc`                  | Append-only: any missing line from the kit's required-lines list is added and every existing line is kept verbatim. A `//npm.pkg.github.com/:_authToken=…` line is **not** removed, in either the literal or the `${NODE_AUTH_TOKEN}` form. The kit does not distribute the credential line (pnpm ignores an env-var credential from a project `.npmrc` unless `npmrcAuthFile` declares the file trusted, so distributing it would only warn), but a consumer that has opted in owns a live credential there — and the opt-in commonly lives in a deploy platform's dashboard, invisible to sync. Kit `< 1.60.0` stripped it and broke such deploys; see [authentication.md §4(d)](./authentication.md#4-build-platforms-with-no-user-level-npmrc)                                 |
| `eslint.config.js`        | Overwrite with the current kit template (no merge — same model as Playwright)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `tsconfig.json`           | Rewrite a retired `@joshuafolkken/*/tsconfig/*.jsonc` preset path to `.json`, then prepend the kit preset to the `extends` array — unless an `@joshuafolkken/*` tsconfig preset that already embeds kit base is present (e.g. app-kit's `tsconfig/sveltekit.json`) — then strip any `compilerOptions` key whose value equals the kit base preset (removing it as empty); value-divergent overrides and `include` are preserved, and the generated-output directories (`playwright-report`, `test-results`, plus `node_modules` / `build` / `dist`) and SvelteKit's `src/service-worker*` exclusions are union-merged into `exclude`. Rewrites are emitted prettier-clean (arrays are laid out the way prettier would — inline while they fit, one entry per line once they do not) |
| `cspell.config.yaml`      | Prepend the kit import to the `import:` list, unless already present or superseded by an `@joshuafolkken/*` cspell preset that already imports kit base (e.g. app-kit's or game-kit's import)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `lefthook.yml`            | Prepend the kit preset to the `extends:` list — unless an `@joshuafolkken/*` lefthook preset that already extends kit base is present (e.g. app-kit's `lefthook/sveltekit.yml`); adding a second kit-base extend would crash lefthook with a "possible recursion in extends" error                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `.secretlintrc.json`      | Created when absent; an existing file is never rewritten, because its rule list becomes project-owned (custom patterns, deliberate exclusions) once written                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `package.json`            | Add the `secretlint` / `@secretlint/secretlint-rule-preset-recommend` devDependencies when missing, so projects initialized before the secretlint pre-commit rule can run it. A version the consumer already pinned is never changed. Until the following `pnpm install` lands the packages, the hook skips with a notice rather than blocking the commit                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `.vscode/extensions.json` | Append missing kit recommendations to `recommendations`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `.vscode/settings.json`   | Add missing top-level keys; for a key the project already owns, merge in kit's missing entries when both values are objects (a project entry always wins over kit's). Array- and scalar-valued keys the project owns are never touched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Kit-only `.vscode/settings.json` keys (currently `sonarlint.connectedMode.project`, which points at the kit's own SonarQube project) are stripped from the template before distribution, so they are never written into consumer projects.

Every rewrite above is emitted the way prettier would format that particular file, so a file kit edits never fails the project's own `prettier --check`. This is per-filename, not one rule: prettier formats `package.json` with its `json-stringify` printer, which puts every array element on its own line no matter how short the array, while `tsconfig.json` and `.vscode/*.json` go through the `json` printer, which keeps a short array inline. kit writes each accordingly — see [kit#797](https://github.com/joshuafolkken/kit/issues/797), where the tsconfig rule was applied to `package.json` and inlined arrays like `keywords` that prettier then demanded back.

Object-valued settings are registries of independent entries (`files.associations`, `editor.codeActionsOnSave`, the per-language `[typescript]` blocks), so sync merges them one entry at a time: kit's entries are added, and any entry the project already declares keeps its own value. Without this, a project that customized such a key for one reason would silently never receive any later kit addition inside it. Arrays stay create-only — combining a list like `eslint.validate` would be a guess about intent, and overwriting it would drop the project's own entries.

### tsconfig normalization

`josh sync` keeps consumer `tsconfig.json` files minimal: any `compilerOptions` key whose value already equals the kit base preset (`base.json`) is redundant — the preset supplies it via `extends` — so sync removes it. A key whose value **differs** from the base (e.g. a library's `noEmitOnError: false`) is an intentional override and is preserved — sync cannot tell a necessary override from an unnecessary one, so it conservatively keeps every value-divergent key. `include` and project-specific keys the base does not define are also left untouched; `exclude` is union-merged (next section).

### tsconfig exclude — generated output and SvelteKit exclusions

`josh sync` union-merges `node_modules`, `build`, `dist`, `playwright-report`, `test-results` and SvelteKit's six `src/service-worker*` globs into the consumer `exclude`: entries the project authored are kept verbatim, only missing ones are appended, and a re-sync on an already-merged file is a no-op.

The reason it is a merge rather than a create-only write: every existing consumer already has a `tsconfig.json`, so a strategy that only writes new files would leave the whole installed base type-checking Playwright's generated report. `playwright.config.ts` points the `html` reporter at `playwright-report/`, which holds Playwright's own minified trace-viewer bundle — a project with a broad `include` gets thousands of `tsc --noEmit` errors from third-party output right after running the E2E suite kit ships the config for. The report directory cannot simply live under the already-ignored `test-results/`: Playwright rejects an HTML output folder nested inside the tests output folder (and vice versa) as a configuration error, so both directories are excluded instead.

The entries must land in the **consumer** file: a `tsconfig.json` `exclude` **overrides** the extended preset's rather than merging with it, so putting them in `base.json` — or in app-kit's `tsconfig/sveltekit.json` — would have no effect on any project that declares its own. Declaring `exclude` also disables TypeScript's implicit exclusion of `outDir`, so a project with a custom `outDir` outside `build` / `dist` should add it to the list.

That same override rule is why the `src/service-worker*` globs are merged in as well. A SvelteKit project extends `./.svelte-kit/tsconfig.json`, which excludes those paths itself, and writing any `exclude` key into the consumer file replaces that array outright — so before [kit#796](https://github.com/joshuafolkken/kit/issues/796) all six were silently discarded, and a project that later added `src/service-worker.ts` got a type-check failure several layers away from the file it just wrote. Repeating them makes the merged list additive. They are merged unconditionally — kit has no SvelteKit detection — and in a non-SvelteKit project they usually match nothing; the exception, a project that keeps its own `src/service-worker.ts`, is covered in [init.md → tsconfig exclude](./init.md#tsconfig-exclude).

A merge which has something to append rewrites **only the value it changes**. Every other byte of the file — comments, key order, trailing commas, your own indentation — is passed through untouched, so the `// Path aliases are handled by ...` block `sv create` ships survives a sync. Until [kit#798](https://github.com/joshuafolkken/kit/issues/798) these merges parsed the document and wrote the whole thing back from the parsed object, which silently deleted every comment in it.

Two consequences worth knowing:

- **kit no longer reformats a file it did not author.** A `tsconfig.json` that arrives prettier-clean leaves prettier-clean, because the value kit splices in is rendered the way prettier would render it at that position. One that arrives badly formatted keeps its own layout rather than being quietly normalized — that is the same trade that lets your comments survive, and your own `prettier --write` is the tool for it. The one exception is a missing final newline, which is added back.
- **A comment inside the value being replaced still goes.** Editing `exclude` rewrites the `exclude` array and nothing else, so a comment sitting inside that array is lost while comments around it survive. Redundant `compilerOptions` keys are pruned one at a time precisely so this does not take the whole block's comments with them.

### tsconfig preset extension migration

kit-family tsconfig presets shipped as `*.jsonc` until kit 1.23. Playwright ≥ 1.62 appends `.json` to any `extends` entry that does not already end in it and then throws when the resulting path is missing, so a `.jsonc` preset resolved to `*.jsonc.json` and `playwright.config.ts` failed to load at all — the whole E2E suite could not start. The presets are now shipped as `*.json`, and `josh sync` rewrites any `extends` entry matching `@joshuafolkken/*/tsconfig/*.jsonc` to the `.json` path so an upgrading consumer is repaired automatically. Only kit-family preset paths are rewritten; a project-local `.jsonc` config is left untouched. A tsconfig is parsed as JSONC regardless of extension, so comments in the preset still work.

### Ecosystem-preset dedup (app-kit / game-kit consumers)

kit's base layer for `tsconfig.json`, `cspell.config.yaml`, and `lefthook.yml` is added only when the consumer does not already reference an `@joshuafolkken/*` preset for that subsystem. Every ecosystem preset — kit's own base, or an app-kit / game-kit framework preset — embeds, imports, or extends kit base by construction, so a second kit-base reference would be redundant (cspell / tsconfig) or a hard crash (`lefthook.yml` extends `lefthook/base.yml` twice → "possible recursion in extends"). The check reads the consumer's own config content — not its dependency tree — so it works for any current or future `@joshuafolkken` overlay without a hardcoded package name.

## Path transformation

`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, and other AI files contain references to `prompts/` files. `josh sync` rewrites these paths so they point to the correct location in `node_modules`:

```text
`prompts/foo.md`  →  `node_modules/@joshuafolkken/kit/prompts/foo.md`
```

This transformation is applied to backtick-quoted paths matching the pattern `` `prompts/<path>` ``.

## What does NOT get synced

- `package.json` — largely init-only to avoid clobbering project version / dependencies. To refresh kit-managed scripts or dev-dependency pins, re-run `josh init`. The one exception: `sync` realigns `devEngines.packageManager.version` with the whole `packageManager` pin, `+sha512…` Corepack integrity suffix included (pnpm compares the two as raw strings, so any drift — including a stripped suffix — reintroduces the pnpm `Cannot use both "packageManager" and "devEngines.packageManager"` warning); scripts, dependencies, and the project version are never touched.

## When to run

Run `josh sync` whenever you:

- Upgrade `@joshuafolkken/kit` to a new version
- Want to pull in updated GitHub workflow templates
- Want to reset AI files (`CLAUDE.md`, `AGENTS.md`, etc.) to the latest package version after local edits
