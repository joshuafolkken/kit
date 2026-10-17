# josh sync — Detailed Behavior

For projects already set up with `josh init`, after upgrading kit: which files `josh sync` overwrites, merges or leaves alone. `josh sync` overwrites managed files in your project with the latest versions from the installed `@joshuafolkken/kit` package. Run it after upgrading the package. The reasons behind each behavior below are in [sync-rationale.md](./maintainers/sync-rationale.md), cited section by section as "Rationale:".

```bash
pnpm josh sync
```

Unlike `josh init` (which skips existing files), `josh sync` is designed for keeping managed files up to date. Most managed files are overwritten; `pnpm-workspace.yaml` and `.claude/settings.json` are merged (see below).

> **`josh sync` follows the recorded profile.** A project recording `josh.profile: basic` (or the pre-rename `static`) gets only the files `josh init` gives a `basic` project ([init.md → Project profiles](./init.md#project-profiles)): no workflows, `.codex/*`, `.coderabbit.yaml`, Sonar or config files, and `.claude/settings.json` only when `package.json` also records `josh.workflow: "github"`. Every other project gets the `full` set this page lists.

## What gets synced

### AI files (overwritten)

These files are copied verbatim from the package, with one path transformation applied (see below).

- `CLAUDE.md` is not overwritten: sync only ensures its bootstrap line and package import, keeping your additions ([Path transformation](#path-transformation)).
- `SECURITY.md` is written from a template with your repository's `owner/repo`, and skipped with a warning when `origin` is not on GitHub. If the warning says the file is stale, it still sends reports to kit: replace it with your own policy or delete it.

```text
AGENTS.md           GEMINI.md
CODE_OF_CONDUCT.md
.cursorrules        .coderabbit.yaml    .gitattributes
.mcp.json           .prettierignore     SECURITY.md
tsconfig.sonar.json
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

**`.claude/settings.json` is merged, not overwritten**: sync replaces kit's entries and keeps the ones your project added, so a shared hook or permission can live in the committed file.

| Part of the file                        | What sync does                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks`                                 | Replaces kit's hooks with the distributed ones and removes a hook kit has retired. Every other hook stays, after kit's.                                       |
| `permissions.allow`, `permissions.deny` | Keeps every kit entry present — a kit `deny` you removed comes back — and keeps your own entries after them. An entry kit has withdrawn is removed.           |
| Other keys kit ships                    | Set to kit's value (`permissions.defaultMode`, for example). Inside an object such as `env` or `enabledPlugins`, kit's entries win and your own entries stay. |
| Keys kit does not ship                  | Left as they are.                                                                                                                                             |

- A hook is kit's when its command runs kit's hook launcher (`scripts/hooks/run-hook.sh`) or the installed `dist/josh.js`, or is exactly one of the six `pnpm josh <command>` hooks kit distributed before 2026-09-13 (`audit:provision`, `batch:guard`, `format:edited`, `investigation:guard`, `rule:guard`, `session:lang`).
- A kit `deny` cannot be removed from the project file: the list guards the verification gate. If one is wrong for your project, open an issue on kit.
- An entry kit stops shipping inside an object (an `env` variable, an `enabledPlugins` entry) cannot be told from one you added, so it stays until you delete it. A withdrawn `allow` / `deny` entry is the exception: kit names it and sync removes it.
- `josh sync --force` replaces the file with the distributed one, dropping your additions.
- A file that is not a JSON object is replaced with the distributed one. The merge rewrites the file as plain JSON, so comments in it are not kept.
- The `echo` reminder hooks kit distributed before the hook launcher cannot be told from your own, so one left over from an older kit stays until you delete it.
- `.codex/hooks.json` is generated by kit and is still overwritten.

Rationale: `docs/maintainers/sync-rationale.md` → "The merge of .claude/settings.json".

What else a consumer should know about the files above. Each item is the behavior; why it is that way, and the history behind it, is maintainer rationale in `docs/maintainers/sync-rationale.md`.

- **A package that publishes gets `.pnpmfile.mjs`, a private one does not.** It strips the safe-chain `preinstall` from the packed manifest ([init.md → Package scripts](./init.md#package-scripts)). After a new or changed pnpmfile, run `pnpm install` and commit `pnpm-lock.yaml` before CI's frozen install. A pnpmfile of your own — a `.pnpmfile.mjs` without kit's `// josh-managed-pnpmfile: @joshuafolkken/kit` first line, a `.pnpmfile.cjs`, or a `pnpmfile` / `pnpmfiles` setting — is left alone with a warning.
- **The distributed skills ship as the `kit` Claude Code plugin, not as copies.** They load from `node_modules/@joshuafolkken/kit/.claude/skills/` as `kit:<name>` once you trust the workspace — an interactive session from its first session, a headless one (`claude -p`) from its second. Sync removes a leftover copied skill directory only while it still matches what kit shipped; one you edited is kept with a warning. Rationale: `docs/maintainers/sync-rationale.md` → "The skills ship as a plugin".
- **Every distributed workflow is overwritten on each sync**, so its action SHA pins come from kit. `dependabot.yml` turns npm version-update PRs off; only security advisories open npm PRs, which needs the repository's **Dependabot security updates** setting. `josh init`, `josh sync` and `josh doctor` report that setting and print the enabling command when it is off; kit never changes it. Rationale: `docs/maintainers/sync-rationale.md` → "Dependabot: the github-actions backstop and npm version updates".
- **`.github/workflows/dependabot-auto-merge.yml` auto-merges Dependabot `github-actions` patch and minor bumps only** — never an npm bump, never a major — and never a bump to a workflow an upstream package overwrites (one carrying the header below), because the next sync would write that pin back. Rationale: `docs/maintainers/sync-rationale.md` → "The auto-merge workflow and what it never merges".
- **It also withdraws an auto-merge the run is not entitled to**, including one armed by hand. A withdrawal that still fails after its retries leaves a comment on the pull request. Rationale: `docs/maintainers/sync-rationale.md` → "Arming and withdrawing auto-merge".
- **That workflow needs the repository's Allow auto-merge setting**, which is off by default. `josh init`, `josh sync` and `josh doctor` report it and print the enabling command when it is off; kit never runs it, `josh doctor --fix` included. Rationale: `docs/maintainers/sync-rationale.md` → "The Allow auto-merge prerequisite".
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
- **`.claude/settings.json` denies the commands the prompts forbid most often** — staging and committing, pull request merges, force pushes and branch deletions. `pnpm josh git`, `pnpm josh followup` and your own terminal are unaffected. It is a guardrail, not a sandbox; `CLAUDE.md` stays the authority. Rationale: `docs/maintainers/sync-rationale.md` → "The deny list in .claude/settings.json".
- **The same file caps a Bash result** with `BASH_MAX_OUTPUT_LENGTH` in its `env` block; `prompts/collaboration-workflow/output-bounds.md` has the value. Rationale: `docs/maintainers/sync-rationale.md` → "The Bash output cap".
- **kit's own copy of the file sets `"enableArtifact": false`; yours does not receive it.** To drop the Artifact tool from your own sessions, add the key to `.claude/settings.local.json` or `~/.claude/settings.json`. Rationale: `docs/maintainers/sync-rationale.md` → "The Artifact tool is switched off in kit only".
- **`verify-ui` is the skill behind the UI verification gate.** It captures the affected routes through your toolkit's screenshot command (`josh-app shot`), and where none exists it says so and leaves the gate open. Rationale: `docs/maintainers/sync-rationale.md` → "The verify-ui skill".
- **The `workflow-commands` and `dependency-update` skills hold the workflow procedures** the AI documents point to. A skill directory copy merges and never prunes: a file removed upstream stays until you delete it, and a file you add beside `SKILL.md` survives every sync. Rationale: `docs/maintainers/sync-rationale.md` → "Skills that hold what the AI documents used to inline".
- **The same file wires the session hooks** — `audit:provision`, `session:lang`, `pretool:guard`, `format:edited` and `stop:guard` ([josh-commands.md](./josh-commands.md)). Switch a guard off with `JOSH_BATCH_GUARD=off`, `JOSH_INVESTIGATION_GUARD=off` or `JOSH_RULE_GUARD=off` in the environment or `.env`. Rationale: `docs/maintainers/sync-rationale.md` → "The hooks in .claude/settings.json".

### `pnpm-workspace.yaml` (merged)

`pnpm-workspace.yaml` is **merged**, not overwritten: every key and value you already have is kept, and kit-managed keys (`minimumReleaseAge`, `engineStrict`, `minimumReleaseAgeExclude`, `allowBuilds`, `overrides`, `trustLockfile`) are added only when missing. `allowBuilds` is merged inside: a block-style map gains the approvals it lacks, and entries you already answered keep their values.

`josh init` and `josh sync` also write `.aikido` from the workspace:

- `minimumReleaseAgeExclude` → `safe-chain.npm.minimumPackageAgeExclusions`. Edit the exceptions in `pnpm-workspace.yaml`, then run `josh sync`.
- `minimumReleaseAge` (minutes, floored to whole hours) → `safe-chain.minimumPackageAgeHours`. With no window declared, the field is left alone.
- Other `.aikido` sections are kept byte-for-byte.

They write each `.github/dependabot.yml` entry's `cooldown` from the same window:

- `minimumReleaseAge` (minutes, rounded up to whole days, kept within 1–90) → `cooldown.default-days`. With no window declared, or no `pnpm-workspace.yaml`, the default is 3 days.
- `minimumReleaseAgeExclude` → the npm entry's `cooldown.exclude` only.
- Only the `cooldown` keys are rewritten; every other key and comment is kept. `josh sync` first replaces the file with kit's copy, so only `josh init` on an existing file keeps your own keys.

`minimumReleaseAge` is the one place to change the window.

Safe Chain reads these settings from 1.5.15. If it still reports a minimum-age block despite an exclusion, update the Safe Chain your shell uses (`safe-chain --version`).

If `josh version --upgrade` fails during project re-resolution, its final error lists the failed command; the steps that succeeded stay applied, so check both versions before retrying.

`trustLockfile: true` keeps clean CI environments that cannot authenticate private `@joshuafolkken/*` GitHub Packages from failing with `ERR_PNPM_TARBALL_URL_MISMATCH`; `minimumReleaseAge` still applies at resolution time.

Rationale: `docs/maintainers/sync-rationale.md` → "The pnpm-workspace.yaml and .aikido merge".

### File mappings (overwritten if source exists)

These are fully-managed files whose package source has a different name than the destination. They are byte-copied on every sync (consumers do not hand-edit them):

| Package source                                  | Destination                                   |
| ----------------------------------------------- | --------------------------------------------- |
| `templates/workflows/ci.yml`                    | `.github/workflows/ci.yml`                    |
| `templates/workflows/dependabot-auto-merge.yml` | `.github/workflows/dependabot-auto-merge.yml` |
| `templates/workflows/github-release.yml`        | `.github/workflows/github-release.yml`        |

If the source file does not exist in the installed package, the destination is skipped with a warning. `.gitignore` is union-merged, not copied — see the table below.

### `sonar-project.properties` (regenerated)

The Sonar config is regenerated from the current GitHub repo name (fetched via `gh api repos/{owner}/{repo}`). If `gh` is unavailable or the repo cannot be identified, this file is skipped with a warning.

The project key and organization are derived from the `owner/repo` slug:

- `project_key` → `owner_repo` (slash replaced with underscore, lowercased)
- `organization` → `owner` (lowercased)

### Config files (merged, only when already present)

These files are created by `josh init`. `josh sync` refreshes them in place with the same merge `init` uses, and never creates them, so a project that opted out stays out. A file already current is logged `unchanged` and not written. `.secretlintrc.json` and `.vscode/tasks.json` are the exceptions: each is created when missing.

| File                      | Merge strategy                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitignore`              | Append missing kit patterns; your entries are kept                                                                                                                               |
| `.npmrc`                  | Remove the four settings lines earlier kit releases wrote, when they match exactly; keep every other line, including a GitHub Packages `_authToken` line                         |
| `eslint.config.js`        | Regenerated from the vanilla template, keeping your `rules` blocks; a config not built on `create_vanilla_config` is left untouched                                              |
| `tsconfig.json`           | Prepend the kit preset to `extends`, drop `compilerOptions` keys equal to the preset, union-merge `exclude` ([tsconfig normalization](#tsconfig-normalization))                  |
| `cspell.config.yaml`      | Prepend the kit import to `import:`, unless an `@joshuafolkken/*` preset already imports it                                                                                      |
| `lefthook.yml`            | Prepend the kit preset to `extends:`, unless an `@joshuafolkken/*` preset already extends it                                                                                     |
| `.secretlintrc.json`      | Created when absent; an existing file is never rewritten                                                                                                                         |
| `package.json`            | Targeted migrations only (missing devDependencies, `devEngines`, kit's `prepare` clause) — see [What does NOT get synced](#what-does-not-get-synced)                             |
| `.vscode/extensions.json` | Append missing kit recommendations to `recommendations`                                                                                                                          |
| `.vscode/settings.json`   | Add missing top-level keys; inside an object-valued key you own, add kit's missing entries (yours win). Array and scalar keys you own are never touched                          |
| `.vscode/tasks.json`      | Created when absent; otherwise a task with a label kit ships (`josh: run board`) is replaced, a missing one appended, others kept. Rename your own task if it shares a kit label |

- **`.npmrc`**: the removed lines are `engine-strict=true`, `minimum-release-age=1440`, `confirmModulesPurge=false` and `lockfile-include-tarball-url=true`, which pnpm 12 ignores there. A `//npm.pkg.github.com/:_authToken=…` line is never removed ([authentication.md §4(d)](./authentication.md#4-build-platforms-with-no-user-level-npmrc)).
- **`.vscode/settings.json`**: kit-only keys (currently `sonarlint.connectedMode.project`) are never written. The Claude Code `bypassPermissions` keys and how to opt out are in [`init.md` → "Claude Code permission mode"](init.md#claude-code-permission-mode).
- **Formatting**: every rewrite is emitted the way prettier formats that file, so it passes your own `prettier --check`.

Rationale: `docs/maintainers/sync-rationale.md` → "The merged config files".

### tsconfig normalization

`josh sync` keeps consumer `tsconfig.json` files minimal: any `compilerOptions` key whose value equals the kit base preset (`base.json`) is removed. A key whose value **differs** is kept as an intentional override, and so are `include` and keys the base does not define.

A retired `@joshuafolkken/*/tsconfig/*.jsonc` preset path in `extends` is rewritten to `.json`; a project-local `.jsonc` is left alone. The kit preset is not added when an `@joshuafolkken/*` preset that already embeds it (e.g. app-kit's `tsconfig/sveltekit.json`) is present.

A merge rewrites **only the value it changes**: comments, key order and your own layout outside that value are kept, and a missing final newline is added back. A comment inside the replaced value (for example inside `exclude`) is lost.

### tsconfig exclude — generated output and SvelteKit exclusions

`josh sync` union-merges the same `exclude` list `josh init` writes — see [init.md → tsconfig exclude](./init.md#tsconfig-exclude) for the entries and when to add your own.

### Repository labels (created when missing)

Sync creates any missing release-classification label that the synced `pr-classification.yml` requires on the GitHub repository. It is a write to GitHub, not to the working tree; existing labels are left alone.

## Path transformation

The AI files kit distributes carry backtick path references that must resolve in a consumer. `prepack` applies the same transform to the published `CLAUDE.md`, and `josh sync` applies it to the pointer files it copies — `AGENTS.md`, `GEMINI.md`, `.cursorrules`:

```text
`prompts/foo.md`             →  `node_modules/@joshuafolkken/kit/prompts/foo.md`     (bundled)
`eslint/rules/foo.js`        →  `node_modules/@joshuafolkken/kit/eslint/rules/foo.js` (bundled)
`scripts/foo.test.ts`        →  `https://github.com/joshuafolkken/kit/blob/main/scripts/foo.test.ts`  (not bundled)
`docs/`                      →  `https://github.com/joshuafolkken/kit/tree/main/docs/`  (not bundled)
```

Globs such as `` `prompts/**` `` are left alone. `CLAUDE.md` itself is not copied: your tracked `CLAUDE.md` imports the package's transformed `dist/CLAUDE.md`, and `josh sync` only ensures its bootstrap line and import are present ([init.md → AI files](./init.md#ai-files)).

## Refused inside the distribution package's own repository

This section is the single source for the self-sync refusal; [init.md](./init.md#refused-inside-the-packages-own-repository)
links here. `josh sync` and `josh init` both write nothing and exit non-zero when the project they
are aimed at **is** the package that distributes the files:

```text
Refusing to sync: this is @joshuafolkken/kit's own repository.
Syncing here would overwrite the distribution source with its own derived templates.
Run this command from a consumer project instead.
```

The project is recognized by the `name` in its `package.json` matching the running package's own
name, or — when no manifest can be read — by a project root that is, or sits inside, the package
directory. A downstream distributor syncing its own upstream (app-kit running kit's base sync) is an
ordinary consumer sync and is not affected. The detection ships as the
`@joshuafolkken/kit/self-sync-guard` export.

Rationale: `docs/maintainers/sync-rationale.md` → "The self-sync refusal".

## What does NOT get synced

- `package.json` — init-only, so your version and dependencies are not clobbered; re-run `josh init` to refresh kit-managed scripts or dev-dependency pins. The project version is never touched. Sync makes only these targeted changes, and leaves the file byte-identical when none applies:
  - `devEngines.packageManager.version` is realigned with the whole `packageManager` pin, `+sha512…` suffix included.
  - `devEngines.packageManager.onFail` moves from `"error"` to `"download"`, so a pnpm of another version fetches the pinned one instead of refusing to run. A `"warn"` or `"ignore"` you set is kept.
  - The tools your project resolves itself are added to `devDependencies` when missing: `eslint`, `prettier`, `typescript`, `@playwright/test`, `cspell`, `lefthook` (only with Git), the three Prettier preset plugins and `@types/node`. A tool you already list in any dependency field is left alone. The secretlint packages are added when `devDependencies` lacks them; a version you pinned there is kept. kit's optional ESLint peers are not added — re-run `josh init` for those ([init.md → Dependencies](./init.md#dependencies)).
  - The `prepare` clause kit itself wrote is rewritten so a failed `lefthook install` warns ([init.md → Package scripts](./init.md#package-scripts)).

  Run `pnpm install` afterwards. Rationale: `docs/maintainers/sync-rationale.md` → "The package.json migrations".

## When to run

Run `josh sync` whenever you:

- Upgrade `@joshuafolkken/kit` to a new version
- Want to pull in updated GitHub workflow templates
- Want to reset the copied AI files (`AGENTS.md`, `GEMINI.md`, `.cursorrules`, workflows) to the latest package version after local edits
