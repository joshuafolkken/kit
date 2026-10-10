# josh sync — Detailed Behavior

For projects already set up with `josh init`, after upgrading kit: which files `josh sync` overwrites, merges or leaves alone. `josh sync` overwrites managed files in your project with the latest versions from the installed `@joshuafolkken/kit` package. Run it after upgrading the package. The reasons behind each behavior below are in [sync-rationale.md](./maintainers/sync-rationale.md), cited section by section as "Rationale:".

```bash
pnpm josh sync
```

Unlike `josh init` (which skips existing files), `josh sync` is designed for keeping managed files up to date. Most managed files are overwritten; `pnpm-workspace.yaml` is merged (see below).

> **`josh sync` follows the recorded profile.** When `package.json` records `josh.profile` as `basic` (or the pre-rename `static`), sync writes only the files `josh init` gives a `basic` project — `AGENTS.md`, `GEMINI.md`, `.cursorrules`, the `basic` templates of `.prettierignore` (only with HTML/CSS/JS files) and `pnpm-workspace.yaml`, `.gitattributes` with Git, and, with a GitHub remote, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/pull_request_template.md` and `.github/release.yml`. It keeps `CLAUDE.md` on the `basic` rules import, moves the pre-rename `CLAUDE.static.md` import and `prettier/static` preset path onto the `basic` ones, and writes none of the workflows, `.claude/settings.json`, `.codex/*`, `.coderabbit.yaml`, Sonar or config files below. Every other project — `full` recorded, or no profile recorded — gets the `full` set this page lists ([#2827](https://github.com/joshuafolkken/kit/issues/2827)).

## What gets synced

### AI files (overwritten)

These files are copied verbatim from the package, with one path transformation applied (see below). `CLAUDE.md` is not overwritten: sync only ensures its bootstrap line and package import, keeping your additions (see [Path transformation](#path-transformation)).

```text
AGENTS.md           GEMINI.md
CODE_OF_CONDUCT.md
.cursorrules        .coderabbit.yaml    .gitattributes
.mcp.json           .ncurc.json         .prettierignore
SECURITY.md         tsconfig.sonar.json
.github/workflows/ci.yml
.github/workflows/auto-tag.yml
.github/workflows/dependabot-auto-merge.yml
.github/workflows/github-release.yml
.github/workflows/pr-classification.yml
.github/workflows/production.yml
.github/workflows/sonar-qube.yml
.github/actions/setup-pnpm/action.yml
.github/actions/setup-node/action.yml
.github/pull_request_template.md
.github/release.yml
.github/dependabot.yml
.claude/settings.json
.codex/config.toml
.codex/hooks.json
```

The Codex project files are managed by kit. Sync overwrites both files, and rewrites `.codex/hooks.json` commands to run the consumer's installed kit bundles. If sync is run from a newer kit than the consumer has installed, it skips both hook files (`.claude/settings.json` and `.codex/hooks.json`) and tells the consumer to update the installed package first; `.codex/config.toml` can still be synced.

What else a consumer should know about the files above. Each item is the behavior; why it is that way, and the history behind it, is maintainer rationale in `docs/maintainers/sync-rationale.md`.

- **A package that publishes gets `.pnpmfile.mjs`, a private one does not.** When `package.json` is not `private: true`, sync (both profiles) copies kit's `.pnpmfile.mjs`, whose `beforePacking` hook strips the safe-chain `preinstall` from the packed manifest — so it keeps guarding your own installs but never ships to the people who install your package; any other lifecycle script ships as before ([#3110](https://github.com/joshuafolkken/kit/issues/3110)). A new or changed hook changes the lockfile's `pnpmfileChecksum`, so run `pnpm install` and commit `pnpm-lock.yaml` before CI's frozen install. A project with a pnpmfile of its own — a `.pnpmfile.mjs` that does not start with `// josh-managed-pnpmfile: @joshuafolkken/kit`, a `.pnpmfile.cjs`, or a `pnpmfile` / `pnpmfiles` setting in `pnpm-workspace.yaml` or `.npmrc` — is left alone with a warning, and the stripping is then up to you.
- **The distributed skills ship as the `kit` Claude Code plugin, not as copies.** `.claude/settings.json` declares the `kit` marketplace and enables the `kit` plugin; the skill bodies load from `node_modules/@joshuafolkken/kit/.claude/skills/`. Nothing needs installing: once you trust the workspace, Claude Code reads the declaration and loads the skills as `kit:<name>` — an interactive session from its first session, a headless one (`claude -p`) from its second. An untrusted workspace loads none. Sync removes a leftover copied skill directory — including one for a skill no longer distributed — only while it still matches what kit shipped; a copy you edited or authored is kept with a warning. Rationale: `docs/maintainers/sync-rationale.md` → "The skills ship as a plugin".
- **Every distributed workflow is overwritten on each sync**, so its action SHA pins come from kit. The distributed `dependabot.yml` keeps a `github-actions` entry as a backstop for workflows you add yourself, and its `npm` entry sets `open-pull-requests-limit: 0`: npm version-update PRs are off, and only security advisories open npm PRs — which requires the repository's **Dependabot security updates** setting. `josh init`, `josh sync` and `josh doctor` report that setting as `enabled`, `paused`, `disabled` or `could not be read` (`sync` always; `init` and `doctor` only where kit's `dependabot.yml` is present) and never fail on it. When it is off they print the enabling command; a paused repository is resumed from its Security → Dependabot page. kit never changes the setting itself. Rationale: `docs/maintainers/sync-rationale.md` → "Dependabot: the github-actions backstop and npm version updates".
- **`.github/workflows/dependabot-auto-merge.yml` auto-merges Dependabot `github-actions` patch and minor bumps only** — never an npm bump, never a major — and never a bump to a workflow an upstream package overwrites (one carrying the header below), because the next sync would write that pin back. Rationale: `docs/maintainers/sync-rationale.md` → "The auto-merge workflow and what it never merges".
- **It also withdraws an auto-merge the run is not entitled to**, including one armed by hand, while leaving a hand-armed bump that merely does not qualify alone. Arming is refused if the branch moved since the run decided (`--match-head-commit`); a withdrawal that still fails after its retries leaves a comment on the pull request; and runs are serialized per pull request by a `concurrency` group. Rationale: `docs/maintainers/sync-rationale.md` → "Arming and withdrawing auto-merge".
- **That workflow needs the repository's Allow auto-merge setting**, which is off by default. `josh init`, `josh sync` and `josh doctor` report it as `enabled`, `disabled` or `could not be read` (`sync` always; `init` and `doctor` only where a workflow calling `gh pr merge --auto` is present) and print the enabling command when it is off; kit never runs it, `josh doctor --fix` included. Rationale: `docs/maintainers/sync-rationale.md` → "The Allow auto-merge prerequisite".
- **Every workflow kit writes starts with a managed header** — and so do the local composite actions the workflows call: `.github/actions/setup-pnpm/action.yml`, which `ci.yml` and `pr-classification.yml` install through, and `.github/actions/setup-node/action.yml`, the one place the workflows' Node.js version is written:

  ```yaml
  # josh-managed-workflow: @joshuafolkken/kit
  # Overwritten on every sync of that package. Edit it there, not here.
  ```

  `josh init` does not stamp a workflow file that already exists; it warns that the auto-merge workflow treats that file as yours until `sync` writes the header. `deploy-vps.yml` is patched but never stamped, so bumps to its own pins still auto-merge. A package built on kit stamps the files it distributes through the same helper, passing its own package name:

  ```ts
  import { managed_marker_logic } from '@joshuafolkken/kit/managed-marker'

  const written = managed_marker_logic.apply_marker_for_destination(
  	destination,
  	content,
  	'@joshuafolkken/app-kit',
  )
  ```

  Rationale: `docs/maintainers/sync-rationale.md` → "The managed-workflow stamp".

- **Action pins are resolved when a workflow is written, not read from the template** — each `uses:` ref is taken from kit's own `.github/workflows/*`, by `josh init` and `josh sync` alike. Rationale: `docs/maintainers/sync-rationale.md` → "Action pins are resolved at write time".
- **`.claude/settings.json` denies the commands the prompts forbid most often** — staging and committing (`git add`, `git commit`, `git restore --staged` and the like), pull request merges (`gh pr merge` and its REST and GraphQL spellings), force pushes and branch deletions. `pnpm josh git` and `pnpm josh followup` are unaffected, and so is your own terminal. It is a guardrail, not a sandbox: some spellings still get through, and `CLAUDE.md` stays the authority on what is forbidden. Rationale: `docs/maintainers/sync-rationale.md` → "The deny list in .claude/settings.json".
- **The same file caps a Bash result** with `BASH_MAX_OUTPUT_LENGTH` in its `env` block; `prompts/collaboration-workflow/output-bounds.md` has the value. Rationale: `docs/maintainers/sync-rationale.md` → "The Bash output cap".
- **kit's own copy of the file sets `"enableArtifact": false`; yours does not receive it.** `josh sync` removes the key on the way out, because Claude Code lets any settings layer that turns the Artifact tool off win, so a shipped `false` could not be undone from `.claude/settings.local.json`. To drop the tool from your own sessions, add the key yourself to `.claude/settings.local.json` or `~/.claude/settings.json`. Rationale: `docs/maintainers/sync-rationale.md` → "The Artifact tool is switched off in kit only".
- **`verify-ui` is the skill behind the UI verification gate.** It captures the affected routes through your toolkit's screenshot command (`josh-app shot`), and where none exists it says so and leaves the gate open. Rationale: `docs/maintainers/sync-rationale.md` → "The verify-ui skill".
- **The `workflow-commands` and `dependency-update` skills hold the workflow procedures** the AI documents point to. A skill directory copy merges and never prunes: a file removed upstream stays until you delete it, and a file you add beside `SKILL.md` survives every sync. Rationale: `docs/maintainers/sync-rationale.md` → "Skills that hold what the AI documents used to inline".
- **The same file wires the session hooks**: `pnpm josh audit:provision` on `SessionStart`; `pnpm josh session:lang` on `UserPromptSubmit`; one `PreToolUse` process, `pnpm josh pretool:guard`, on `Bash`, `Edit`, `Read`, `Write` and `AskUserQuestion`, which runs the batching, investigation and rule guards together and states the work-summary reminder once, on a session's first `Edit` / `Write` of a runtime file; `pnpm josh format:edited` after every `Edit` and `Write`; and `pnpm josh stop:guard` on `Stop`. Each guard is switched off by `JOSH_BATCH_GUARD=off`, `JOSH_INVESTIGATION_GUARD=off` or `JOSH_RULE_GUARD=off` in the environment or `.env`; [josh-commands.md](./josh-commands.md) documents each command. Rationale: `docs/maintainers/sync-rationale.md` → "The hooks in .claude/settings.json".

### `pnpm-workspace.yaml` (merged)

`pnpm-workspace.yaml` is **merged**, not overwritten. Your existing file is the base: all top-level keys it already has (user-added keys like `packages:`, and any value you already set on a managed key) are preserved as-is. Kit-managed keys the template introduces (`minimumReleaseAge`, `engineStrict`, `minimumReleaseAgeExclude`, `allowBuilds`, `overrides`, `trustLockfile`) are appended only when missing. pnpm 12 reads `minimumReleaseAge` and `engineStrict` from this file only — the same settings in `.npmrc` are ignored — so they live here ([#3267](https://github.com/joshuafolkken/kit/issues/3267)). `allowBuilds` is the one key merged inside: an existing block-style map gains the template's approvals it lacks (indented to match its entries; a flow-style `{ … }` map is left whole), and every entry you already answered keeps its value ([#2710](https://github.com/joshuafolkken/kit/issues/2710)).

`josh init` and `josh sync` also copy that project's `minimumReleaseAgeExclude` entries into `.aikido` → `safe-chain.npm.minimumPackageAgeExclusions`. The workspace list is the source: add or remove age exceptions there, then run `josh sync`. Other top-level `.aikido` sections are kept byte-for-byte; an existing `safe-chain` section is serialized again when its exclusion list or minimum age changes. They also copy the workspace's `minimumReleaseAge` (minutes, floored to whole hours) into `safe-chain.minimumPackageAgeHours`, so Safe Chain accepts every version pnpm resolved instead of applying its own 48-hour default; an explicit `minimumReleaseAge: 0` writes `0`, and with no window declared the field is left alone. Safe Chain 1.5.15 or newer reads this project setting. Older installed shims, including 1.2.2 and the former CI pin 1.5.1, ignore it; update the Safe Chain installation used by your shell. Kit's distributed CI now sets up 1.5.20, the latest version outside Safe Chain's 48-hour window when this change was made. Malware scanning and the age limit for packages outside the exclusion list remain active.

If `josh version --upgrade` fails during project re-resolution, its final error lists the failed command and notes that successful steps remain applied. Check both versions before retrying. A Safe Chain minimum-age message despite a `.aikido` exclusion usually means the shell still uses an older Safe Chain shim (`safe-chain --version`).

`trustLockfile: true` skips the install-time supply-chain re-verification introduced in pnpm 11.5 and retained in pnpm 12. Without it, clean CI environments (e.g. Cloudflare Workers Builds) that cannot authenticate private `@joshuafolkken/*` GitHub Packages hit a false `ERR_PNPM_TARBALL_URL_MISMATCH`. `minimumReleaseAge` still applies at resolution time, so age-based supply-chain protection is preserved.

### File mappings (overwritten if source exists)

These are fully-managed files whose package source has a different name than the destination. They are byte-copied on every sync (consumers do not hand-edit them):

| Package source                                  | Destination                                   |
| ----------------------------------------------- | --------------------------------------------- |
| `templates/workflows/ci.yml`                    | `.github/workflows/ci.yml`                    |
| `templates/workflows/dependabot-auto-merge.yml` | `.github/workflows/dependabot-auto-merge.yml` |
| `templates/workflows/github-release.yml`        | `.github/workflows/github-release.yml`        |

If the source file does not exist in the installed package, the destination is skipped with a warning.

> `.gitignore` used to be a byte-copy mapping here, which wiped project-local entries on every sync. It is now **union-merged** instead — see the merged-config table below.

### `sonar-project.properties` (regenerated)

The Sonar config is regenerated from the current GitHub repo name (fetched via `gh api repos/{owner}/{repo}`). If `gh` is unavailable or the repo cannot be identified, this file is skipped with a warning.

The project key and organization are derived from the `owner/repo` slug:

- `project_key` → `owner_repo` (slash replaced with underscore, lowercased)
- `organization` → `owner` (lowercased)

### Config files (merged, only when already present)

These files are created by `josh init`. `josh sync` refreshes them in place by reusing the same merge functions `init` uses — never created on first run, so projects that opted out stay opted out. Each handler is idempotent: when the file is already current, it logs `unchanged` and skips the write.

`.secretlintrc.json` and `.vscode/tasks.json` are the exceptions: each **is** created when missing. `.secretlintrc.json` is, because the pre-commit secret scan it configures ships to every consumer through `lefthook/base.yml` and cannot run without it. There is no opt-out to preserve — a project that predates the rule simply has no such file yet. `.vscode/tasks.json` is, because the folder-open run board task is the whole point of distributing it, and a project without the file has no tasks of its own to protect.

| File                      | Merge strategy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitignore`              | Append any missing kit ignore patterns; consumer-local entries are preserved. Matching is per-line and comments/blank lines are skipped, so re-running is a no-op                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `.npmrc`                  | Cleanup only: the four settings lines earlier kit releases wrote (`engine-strict=true`, `minimum-release-age=1440`, `confirmModulesPurge=false`, `lockfile-include-tarball-url=true`) are removed when they match exactly, since pnpm 12 ignores them in `.npmrc` ([#3267](https://github.com/joshuafolkken/kit/issues/3267)); every other line is kept verbatim, including a setting with a value of your own. A `//npm.pkg.github.com/:_authToken=…` line is **not** removed, in either the literal or the `${NODE_AUTH_TOKEN}` form. The kit does not distribute the credential line (pnpm ignores an env-var credential from a project `.npmrc` unless `npmrcAuthFile` declares the file trusted, so distributing it would only warn), but a consumer that has opted in owns a live credential there — and the opt-in commonly lives in a deploy platform's dashboard, invisible to sync. See [authentication.md §4(d)](./authentication.md#4-build-platforms-with-no-user-level-npmrc) |
| `eslint.config.js`        | Regenerated from the vanilla template, keeping your `rules` blocks; a config not built on `create_vanilla_config` is left untouched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `tsconfig.json`           | Rewrite a retired `@joshuafolkken/*/tsconfig/*.jsonc` preset path to `.json`, then prepend the kit preset to the `extends` array — unless an `@joshuafolkken/*` tsconfig preset that already embeds kit base is present (e.g. app-kit's `tsconfig/sveltekit.json`) — then strip any `compilerOptions` key whose value equals the kit base preset (removing it as empty); value-divergent overrides and `include` are preserved, and the generated-output directories (`playwright-report`, `test-results`, plus `node_modules` / `build` / `dist`) and SvelteKit's `src/service-worker*` exclusions are union-merged into `exclude`. Rewrites are emitted prettier-clean (arrays are laid out the way prettier would — inline while they fit, one entry per line once they do not)                                                                                                                                                                                                          |
| `cspell.config.yaml`      | Prepend the kit import to the `import:` list, unless already present or superseded by an `@joshuafolkken/*` cspell preset that already imports kit base (e.g. app-kit's or game-kit's import)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `lefthook.yml`            | Prepend the kit preset to the `extends:` list — unless an `@joshuafolkken/*` lefthook preset that already extends kit base is present (e.g. app-kit's `lefthook/sveltekit.yml`); adding a second kit-base extend would crash lefthook with a "possible recursion in extends" error                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `.secretlintrc.json`      | Created when absent; an existing file is never rewritten, because its rule list becomes project-owned (custom patterns, deliberate exclusions) once written                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `package.json`            | Add the `secretlint` / `@secretlint/secretlint-rule-preset-recommend` devDependencies when missing, so projects initialized before the secretlint pre-commit rule can run it. A version the consumer already pinned is never changed. Until the following `pnpm install` lands the packages, the hook skips with a notice rather than blocking the commit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `.vscode/extensions.json` | Append missing kit recommendations to `recommendations`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `.vscode/settings.json`   | Add missing top-level keys; for a key the project already owns, merge in kit's missing entries when both values are objects (a project entry always wins over kit's). Array- and scalar-valued keys the project owns are never touched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `.vscode/tasks.json`      | Created from the package template when absent. An existing file is merged per task `label`: a task carrying a label kit ships (currently `josh: run board`, the folder-open run board; a task still carrying the retired `josh: run event watch` label is replaced by it in place) is replaced with kit's definition, a missing one is appended, and every other task is kept as authored, comments included. Rename your own task if it shares a kit label                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Kit-only `.vscode/settings.json` keys (currently `sonarlint.connectedMode.project`, which points at the kit's own SonarQube project) are stripped from the template before distribution, so they are never written into consumer projects.

The template also carries the Claude Code `bypassPermissions` keys; what they do and how a project opts out is [`init.md` → "Claude Code permission mode"](init.md#claude-code-permission-mode).

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

### Repository labels (created when missing)

Sync creates any missing release-classification label that the synced `pr-classification.yml` requires on the GitHub repository ([#2797](https://github.com/joshuafolkken/kit/issues/2797)). It is a write to GitHub, not to the working tree; existing labels are left alone.

## Path transformation

The AI files kit distributes carry backtick path references that must resolve in a consumer. The same transform is applied in two places: `prepack` bakes it into the published `CLAUDE.md` (`scripts/build/build-claude-md.ts`), and `josh sync` applies it to the pointer files it still byte-copies — `AGENTS.md`, `GEMINI.md`, `.cursorrules` ([#963](https://github.com/joshuafolkken/kit/issues/963)):

```text
`prompts/foo.md`             →  `node_modules/@joshuafolkken/kit/prompts/foo.md`     (bundled)
`eslint/rules/foo.js`        →  `node_modules/@joshuafolkken/kit/eslint/rules/foo.js` (bundled)
`scripts/foo.test.ts`        →  `https://github.com/joshuafolkken/kit/blob/main/scripts/foo.test.ts`  (not bundled)
`docs/`                      →  `https://github.com/joshuafolkken/kit/tree/main/docs/`  (not bundled)
```

Bundled directories (`prompts/`, `eslint/`) point into `node_modules`; paths the package does not ship (tests, `docs/`) become full GitHub URLs, since a consumer never receives them. Globs such as `` `prompts/**` `` are left alone. **`CLAUDE.md` itself is no longer byte-copied** ([#1878](https://github.com/joshuafolkken/kit/issues/1878)): the package ships the transformed copy at `dist/CLAUDE.md`. The consumer's tracked `CLAUDE.md` begins with a bootstrap instruction to install dependencies and reread the file if kit is absent, then imports the package rules and carries the project's own additions. `josh sync` ensures that instruction and import are present without overwriting the additions, and a package update keeps the rules current on its own.

## Refused inside the distribution package's own repository

This section is the single source for the self-sync refusal; [init.md](./init.md#refused-inside-the-packages-own-repository)
links here and adds only the empty-directory case. `josh sync` and `josh init` both write nothing
and exit non-zero when the project they are aimed at **is** the package that distributes the files:

```text
Refusing to sync: this is @joshuafolkken/kit's own repository.
Syncing here would overwrite the distribution source with its own derived templates.
Run this command from a consumer project instead.
```

Inside the source repository every copy runs backwards. The mapped workflows are written from
`templates/workflows/` over `.github/workflows/`, which is the authoritative side the pins are
resolved _from_ ([#747](https://github.com/joshuafolkken/kit/issues/747)); the path transformation
rewrites the package's own `` `prompts/…` `` references to `node_modules/@joshuafolkken/kit/prompts/…`,
where nothing resolves; and `tsconfig.json` is pointed at a copy of kit inside kit. Reproduced on a
clean checkout in [#868](https://github.com/joshuafolkken/kit/issues/868): 14 files, `CLAUDE.md`,
`AGENTS.md`, `GEMINI.md` and both mapped workflows among them.

The project is recognized by the `name` in its `package.json` matching the running package's own
name, with two fallbacks for when no manifest can be read there: an identical package/project
directory, and a project root that sits **inside** the package directory (`pnpm josh sync` run from
`kit/docs`). Only that direction refuses — the reverse is the ordinary consumer layout, where the
package always lives at `<project>/node_modules/@joshuafolkken/kit`. The name is what carries the
check: the incident that prompted it ran a **globally installed** copy against the source
repository, so the two directories were unrelated and only the name matched. A downstream
distributor syncing its own upstream — app-kit running kit's base sync inside the app-kit repository
— is an ordinary consumer sync and is not affected.

`josh init` is guarded for the same reason and by the same check
([#879](https://github.com/joshuafolkken/kit/issues/879)). It calls the sync writers directly rather
than through `josh sync`, so the guard on the sync entry point never covered it — and its blast
radius is the larger of the two: on top of the files above it rewrites the project's `package.json`
scripts and devDependencies. A project with no `package.json` yet is covered in
[init.md](./init.md#refused-inside-the-packages-own-repository).

The detection ships as the `@joshuafolkken/kit/self-sync-guard` export so app-kit and game-kit apply
the same rule rather than each re-implementing it.

## What does NOT get synced

- `package.json` — largely init-only to avoid clobbering project version / dependencies. To refresh kit-managed scripts or dev-dependency pins, re-run `josh init`. The project version is never touched. The exceptions are four targeted migrations, each there so a project initialized before a fix receives it **without** re-running `josh init` — every one of them leaves the file byte-identical when it has nothing to change:
  - `devEngines.packageManager.version` is realigned with the whole `packageManager` pin, `+sha512…` Corepack integrity suffix included (pnpm compares the two as raw strings, so any drift — including a stripped suffix — reintroduces the pnpm `Cannot use both "packageManager" and "devEngines.packageManager"` warning).
  - `devEngines.packageManager.onFail` moves from `"error"` to `"download"`, so a standalone pnpm of another version fetches the pinned pnpm instead of refusing to run ([#3388](https://github.com/joshuafolkken/kit/issues/3388)). A `"warn"` or `"ignore"` you set yourself is kept.
  - The secretlint `devDependencies` are added when missing, because the pre-commit rule resolves secretlint from the consumer project. A version you pinned yourself is never overwritten.
  - The `prepare` clause **kit itself wrote** — `command -v lefthook >/dev/null 2>&1 && lefthook install` — is rewritten so a failed `lefthook install` says so on standard error ([#1503](https://github.com/joshuafolkken/kit/issues/1503), [#1507](https://github.com/joshuafolkken/kit/issues/1507)). It is the one place `sync` writes to `scripts`, it matches that exact clause and nothing else, and a `prepare` that never carried it is left alone. Run `pnpm install` afterwards — the rewritten `prepare` only takes effect on the next install. The new clause reports the failure and then returns success, so a hand-written `prepare` that chained kit's clause without a `|| true` of its own stops failing the install and warns instead; that is the same trade [init.md](./init.md#package-scripts) describes for `josh init`.

## When to run

Run `josh sync` whenever you:

- Upgrade `@joshuafolkken/kit` to a new version
- Want to pull in updated GitHub workflow templates
- Want to reset the copied AI files (`AGENTS.md`, `GEMINI.md`, `.cursorrules`, workflows) to the latest package version after local edits
