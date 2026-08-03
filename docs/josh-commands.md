# josh CLI — Command Reference

`josh` is available as `pnpm josh` (or `pnpm exec josh`) after running `josh init`. Run `pnpm josh help` to print a grouped summary in the terminal.

## Development

These commands replace the corresponding `package.json` scripts. Consumer projects no longer need to add them manually.

### `josh lint`

Check code with prettier and eslint.

```bash
pnpm josh lint
pnpm josh lint:prettier   # prettier only
pnpm josh lint:eslint     # eslint only
```

### `josh format`

Format code with prettier and eslint.

```bash
pnpm josh format
pnpm josh format:prettier  # prettier only
pnpm josh format:eslint    # eslint only
```

### `josh cspell`

Run spell check.

```bash
pnpm josh cspell          # *.{ts,js,md,yaml,yml,json}
pnpm josh cspell:dot      # includes dotfiles
```

### `josh test:unit`

Run unit tests with vitest. Because a freshly-bootstrapped project may have no unit suite yet
(and therefore no `vitest` installed), this command **skips gracefully (exit 0)** when `vitest`
is not installed or when no `*.{test,spec}.{ts,js}` files exist — so CI and the local gate never
block a project that has no unit tests yet. Once both `vitest` and at least one test file are
present, it runs `vitest run` as usual.

```bash
pnpm josh test:unit
```

### `josh test:e2e`

Run E2E tests with Playwright. Because `@playwright/test` is an optional peer dependency
and a fresh project may have no e2e suite yet, this command **skips gracefully (exit 0)**
when `@playwright/test` is not installed or when no `*.e2e.{ts,js}` files exist — so the
`pre-push` hook never blocks a project that has opted out of e2e. Once both the package and
at least one e2e file are present, it runs `playwright test` as usual.

```bash
pnpm josh test:e2e
```

### `josh test`

Run unit tests followed by E2E tests.

```bash
pnpm josh test
```

`josh test` is a **composite command** and takes no extra arguments. Pass runner flags to the stage that understands them — `--workers`, `--grep` and `--headed` are Playwright's, `-u` is Vitest's, and a composite cannot route one vocabulary to both stages:

```bash
pnpm josh test:e2e --workers=1   # ✅ reaches Playwright
pnpm josh test:unit -u           # ✅ reaches Vitest
pnpm josh test --workers=1       # ❌ exits 1, naming test:unit and test:e2e
```

See [Composite commands and extra arguments](#composite-commands-and-extra-arguments).

### `josh check`

Type-check a SvelteKit project. Requires `@sveltejs/kit` in dependencies.

```bash
pnpm josh check        # development mode
pnpm josh check:ci     # strict mode (--threshold error), used in CI
```

### Composite commands and extra arguments

A few `josh` commands chain several steps behind one name. They are implemented as a fixed shell script (`sh -c '<step> && <step>'`), and a shell script does not expand arguments appended to it — so anything typed after the command name would land in the shell's positional parameters and be discarded without a word.

**The convention: a composite command either forwards extra arguments deliberately, or refuses them. It never ignores them.** Today every composite refuses, exits `1`, and names the sub-commands that do accept arguments:

```bash
$ pnpm josh test --workers=1
josh test takes no extra arguments — pass them to josh test:unit or josh test:e2e instead
```

| Composite    | Pass arguments to instead                        |
| ------------ | ------------------------------------------------ |
| `test`       | `test:unit`, `test:e2e`                          |
| `format`     | `format:prettier`, `format:eslint`               |
| `latest`     | `latest:corepack`, `latest:update`, `audit`      |
| `main:sync`  | — (chains raw `git` calls; nothing is forwarded) |
| `main:merge` | — (chains raw `git` calls; nothing is forwarded) |

Every other command — the ones that invoke a single tool or script — forwards extra arguments exactly as before; `pnpm josh test:e2e --workers=1` reaches Playwright unchanged.

The refusal is driven by the **shape** of the command rather than a per-command opt-in, so a composite added later cannot reintroduce the silent discard by forgetting to declare itself. A unit test audits the whole command map on every commit.

---

## Project

Commands for setting up and maintaining a project.

### `josh init`

Initialize config files in a new project.

```bash
pnpm josh init
```

Creates or merges all config files. See [init.md](./init.md) for the full list of files created and merged.

### `josh sync`

Overwrite managed files with the latest versions from the package.

```bash
pnpm josh sync
```

Run after upgrading `@joshuafolkken/kit` to pull in updated AI files, GitHub workflow templates, and other managed files. See [sync.md](./sync.md) for the full list. `sync` also realigns `devEngines.packageManager.version` in `package.json` with the `packageManager` pin so the two never drift apart (a mismatch reintroduces the pnpm `Cannot use both "packageManager" and "devEngines.packageManager"` warning).

> To make `josh` available system-wide, install the kit globally (`pnpm add -g @joshuafolkken/kit`) instead of running an install subcommand. See [cli.md](./cli.md) for details.

---

## Workflow

AI-assisted git and notification helpers used in the day-to-day development loop.

### `josh git`

Interactive AI-assisted git commit workflow: stages changes, generates a commit message, and optionally pushes.

```bash
pnpm josh git
pnpm josh git -y          # run non-interactively (skip confirmation prompts)
pnpm josh git -y "title"  # set commit message prefix
```

`-y` / `--yes` runs the workflow unattended — it also works without a TTY (e.g. an AI agent or CI shell). When no issue argument is supplied, the issue number and title are derived from the current branch name (`<N>-<slug>`), so recovery commands such as `pnpm josh pr` and `pnpm josh git -y --skip-commit --skip-push` create the PR without prompting.

### `josh followup`

AI-assisted PR follow-up workflow: waits for CI, checks AI reviewer findings, sends a completion notification, and optionally merges.

```bash
pnpm josh followup "PR title #N"
pnpm josh followup "PR title #N" --merge
pnpm josh followup "PR title #N" --merge --notify-message "Implemented X:\n- change 1\n- change 2"
pnpm josh followup "PR title #N" --merge --ai-review-ignore-reason "false positive"
```

On completion, the project's own version (from `package.json`, the value `josh bump` increments) is printed as the final line (`📦 project version: <v>`) and included in the completion Telegram body, so the just-shipped version is visible at the end of the workflow.

While inspecting those children it also reports when the epic body declares a dependency chain (`#101 -> #102` under `Dependencies`) but **none** of the children carries a `blocked-by` relation, meaning the batch order was never recorded natively. The declaration is what triggers the check: an epic is created for every split, ordered or not, so its mere existence says nothing about ordering and warning on that alone would fire on every unordered batch. The check is deliberately weak — it never judges the shape of the chain, only its total absence — and it runs on every child's merge rather than at epic close, so the omission surfaces while it can still be corrected.

After the merge, `followup` also closes any completed epic. It looks for open issues labelled `epic` whose markdown task list references the issue this PR closed; when every other child in that list is already closed, the epic is closed with a comment naming its children. The just-closed issue is treated as closed without being queried, because GitHub applies the `closes #N` side effect asynchronously. An epic with a still-open child is left alone, and any failure in this step is reported as a warning rather than failing the run — the PR has already merged by then. Two cases are skipped on purpose: an epic whose task list tracks a child in **another repository** is never closed automatically (resolving that child's state would need a different repo, and ignoring it could close the epic while the child is open), and nothing runs at all on a `--no-merge` run, where the linked issue is still open.

### `josh notify`

Send a Telegram notification. Used for planning, confirmation, failure, and kickoff-retry alerts.

```bash
pnpm josh notify --task-type planning --issue-url "https://..." --body="- bullet 1\n- bullet 2"
pnpm josh notify --task-type confirmation --issue-url "https://..." --body="Waiting for approval"
pnpm josh notify --task-type failure --issue-url "https://..." --body="Build failed"
```

Task types: `planning` 📋 · `completion` ✅ · `failure` ❌ · `kickoff_retry` 🔄 · `confirmation` ⏸️

Note: do not use `--task-type completion` manually — always use `josh followup` instead, which automatically includes the PR URL.

### `josh main:sync`

Checkout `main` and pull the latest changes.

```bash
pnpm josh main:sync
```

### `josh main:merge`

Pull the latest changes from `origin main` into the current branch.

```bash
pnpm josh main:merge
```

---

## Versioning

### `josh bump`

Bump the package version in `package.json`.

```bash
pnpm josh bump major
pnpm josh bump minor
pnpm josh bump patch
```

After bumping, update `docs/` to reflect any behavior changes before committing.

### `josh version`

Show the global install version, the current project version, and the latest published version — all in one report, regardless of how `josh` was invoked.

```bash
pnpm josh version   # alias: josh v
```

`version` (and `version:upgrade`) always inspect **both targets**:

- **Global**: queried via `pnpm ls -g @joshuafolkken/kit`.
- **Project**: read from `node_modules/@joshuafolkken/kit/package.json` in the current directory.

In addition, `version` reports the **running binary** — the version and package directory of the install that actually executed, resolved from `import.meta.url`. The running binary is the single source of truth: the `Running:` line tells you which `josh` produced this very report, independent of the global/project query. This restores the guarantee that a stale or shadowing binary self-reports rather than hiding behind the `pnpm ls -g` number.

A target that is not installed is reported as `not installed`. A stale target gets a `Run:` hint with the exact upgrade command (`pnpm add -g` for global, `pnpm add -D … && fix-gh-packages` for the project). `josh v` and `pnpm josh v` produce the same report.

#### PATH shadowing warning

When the `josh` first on `PATH` is **not** the pnpm-global install — for example a stale `~/.local/bin/josh` shim left behind by a project pinned below `v0.200.0` (see [the design note below](#design-per-project-installs-must-not-touch-the-global-path)) — `version` appends a warning naming both paths and the recovery command:

```text
⚠ PATH shadowing: the 'josh' first on PATH is not the pnpm-global install.
  On PATH:     /Users/you/.local/bin/josh
  pnpm global: /Users/you/Library/pnpm/bin/josh
  Recover:     josh doctor --fix
```

Run [`josh doctor --fix`](#josh-doctor) to reclaim the global CLI. The warning is silent when there is no shadowing.

### `josh version:upgrade`

Upgrade `@joshuafolkken/kit` to the latest published version for **both** the global install and the current project.

```bash
pnpm josh version:upgrade   # alias: josh vu
```

Both `josh vu` and `pnpm josh vu` behave the same: the global install is upgraded with `pnpm add -g`, and the project devDependency with `pnpm add -D` followed by a re-run of `fix-gh-packages`. A target that is not installed or already up to date is skipped. Inside the kit repo itself there is no `node_modules/@joshuafolkken/kit`, so the project target is naturally skipped — no accidental self-install.

---

## Maintenance

### `josh doctor`

Diagnose — and optionally repair — PATH shadowing of the global `josh`.

```bash
pnpm josh doctor          # alias: josh dr — diagnose only
pnpm josh doctor --fix    # reclaim the global josh by removing a stale kit shim
```

`doctor` reports the running binary, the `josh` first on `PATH` (`which josh`), and the pnpm-global install (`pnpm bin -g`). When the PATH `josh` differs from the pnpm-global one, it prints the same shadowing warning as `josh version` plus the recovery command.

`--fix` is your go-ahead to repair: it reads the shadowing binary and, **only if it is a kit shim** (its body references `@joshuafolkken/kit` or the removed `install-bin` script), removes it so the pnpm-global `josh` reclaims `PATH` precedence. Any other shadowing binary is left untouched and reported for manual review — `doctor` never deletes a file it cannot positively identify as a stale kit shim.

#### Design: per-project installs must not touch the global PATH

A per-project dependency's lifecycle hook (`postinstall` / `prepare`) must **never** write to a shared, user-level `PATH` location. Versions prior to `v0.200.0` shipped an `install-bin.ts` `postinstall` that wrote `~/.local/bin/josh` via `os.homedir()`; a single `pnpm install` in any such old project would silently clobber the global `josh` and point it at that project's stale kit. That shim write was removed in [#446](https://github.com/joshuafolkken/kit/pull/446) and must not return — the current kit installs its global CLI only via `pnpm add -g` (bin under `pnpm bin -g`), and a regression test (`scripts/no-global-shim-write.test.ts`) fails if any lifecycle hook or source file reintroduces a shared-PATH write.

**Migration / cleanup.** Projects pinned `< v0.200.0` still carry the old `install-bin.ts` and will re-create the shim whenever they are reinstalled. Upgrade those projects to `>= v0.200.0` (`pnpm add -D @joshuafolkken/kit@latest`). For one-shot recovery when an old project has re-created the shim, run `josh doctor --fix`.

### `josh overrides`

Check that `pnpm.overrides` in `package.json` has not drifted after a dependency update.

```bash
pnpm josh overrides
```

Run after `pnpm update` or `josh latest` to confirm no override was silently removed.

### `josh audit`

Run a security audit against the lockfile.

```bash
pnpm josh audit
```

### `josh reconcile-templates`

Keep the distributed templates in sync with the root files they come from. There are two kinds of pair:

- **Copy pairs** — the template is a byte-for-byte copy of its root source. `.gitignore` → `templates/gitignore` is a copy pair: edit root `.gitignore`, and the template is regenerated automatically. (The dotless `templates/gitignore` exists because npm strips a literal `.gitignore` from the published package; it is renamed back to `.gitignore` when copied into a consumer.)
- **Tripwire pairs** — the template intentionally diverges from its root source. `sonar-project.properties` → `templates/sonar-project.properties` is a tripwire pair: a source edit is recorded as a hash and only forces a conscious review, never automatic propagation.

```bash
pnpm josh reconcile-templates           # regenerate copy templates + record tripwire hashes
pnpm josh reconcile-templates --check    # verify templates are in sync; non-zero on drift
```

Tripwire hashes live in `.template-source-manifest.json` at the repo root (kit-internal; not distributed). A pre-commit hook runs `--check` whenever a tracked source or copy template is staged: a copy pair that is out of date, or a tripwire source that changed without being reconciled, blocks the commit. Run `pnpm josh reconcile-templates` (reviewing any tripwire template first), then commit the regenerated copies and updated manifest alongside the source.

### `josh sync-workflow-pins`

Keep the action SHA pins in `templates/workflows/*` in sync with `.github/workflows/*`. The runtime workflows are the single source of truth for pins; the distributed templates intentionally diverge in structure (steps, commands, comment language), so only the `uses:` SHA pins are propagated.

```bash
pnpm josh sync-workflow-pins           # rewrite template pins to match the runtime workflows
pnpm josh sync-workflow-pins --check    # verify pins are in sync; non-zero on drift
```

Dependabot bumps the runtime workflows under `.github/workflows/` only, so an action bump leaves the templates behind and trips the SHA-parity unit test. After such a bump (e.g. on a Dependabot PR), run `pnpm josh sync-workflow-pins` and commit the synced templates. The command errors if a single action is pinned to conflicting SHAs across the runtime workflows.

### `josh sync-dependabot-pins`

Automate the full template-pin fix over one or more Dependabot action-bump PRs. For each PR number it checks out the PR branch, runs the same sync as `sync-workflow-pins`, and — when pins drifted — commits the template update and pushes it back to the PR branch, then restores the branch you started on. This replaces the manual `gh pr checkout <N>` → `sync-workflow-pins` → commit → push loop.

```bash
pnpm josh sdp 578 641              # sync + push template pins for each Dependabot PR
pnpm josh sync-dependabot-pins 578
pnpm josh sdp --dry-run 578 641    # print the plan per PR; no checkout, commit or push
```

`--dry-run` performs no git side effects (no checkout, commit or push), so it is safe to run against an uncommitted working tree — for example while verifying the command itself before committing. Only template pins under `templates/workflows/` are staged, so unrelated working-tree changes are never committed to a Dependabot PR. As a safety guard the command only commits when the checked-out branch is a `dependabot/…` branch; a mistyped or non-Dependabot PR number is skipped without any commit.

### `josh latest`

Update pnpm via corepack, update all dependencies to latest, and run a security audit.

```bash
pnpm josh latest            # full update (corepack + update + audit)
pnpm josh latest:corepack   # update pnpm only
pnpm josh latest:update     # update dependencies only
```

**`josh latest` never lowers a version.** A supply-chain guard that withholds releases younger than a minimum age (this repo runs `@aikidosec/safe-chain` from `preinstall`) makes the registry report an _older_ release as the newest available. `pnpm update --latest` would then write that older version into `package.json` and `pnpm-lock.yaml` — a silent downgrade attributed to whatever task happened to run the update.

`latest:update` therefore compares the direct-dependency versions before and after the update. If any of them moved down, it restores both files to exactly what it found and says so:

```
⏮ Keeping tsx@^4.23.5 (newest allowed is ^4.23.1) — the newest allowed version is older than the installed one.
   The update was rolled back and no dependency changed: while a pin sits above the newest
   allowed version, the whole tree cannot be resolved. Re-run once the newer release is
   no longer withheld.
```

Three details worth knowing:

- **The whole update is rolled back, not just the offending package.** Excluding it from the update targets would not exclude it from resolution: while an installed version sits above the newest allowed one, that version is unresolvable and `pnpm` fails the entire tree with `ERR_PNPM_NO_MATCHING_VERSION`. The real choice is between a downgrade and no update, and no update is the safer one.
- **The command still exits `0`.** The tree is left byte-identical to what it found, nothing is broken, and every workflow that runs `josh latest` in its preamble would otherwise stop for a condition that resolves itself.
- **The condition is transient.** The newer release is normally still published and still tagged `latest`; only the age gate is hiding it. A later run picks the upgrade up with no intervention.

`latest:update` skips **held-back** and **capped-override** packages instead of blindly bumping everything. `typescript` is currently held back at `6.x`: its `7.x` release is the native (Go) port that exposes no `SyntaxKind`, which crashes the type-aware ESLint stack (`typescript-eslint`, `eslint-plugin-sonarjs`, `ts-api-utils`) at rule-load time. The hold-back is removed to fix forward once that stack supports the native API. Any package whose `pnpm.overrides` key carries a lower-bound cap (e.g. `"some-pkg@>=5": "^4"`) is also skipped. Skipped packages are printed as `⏭ Skipping held-back / capped packages: …`.

`latest:corepack` pins pnpm to the newest release on the project's **current major** (`latest-<major>`, derived from `packageManager`; it falls back to `pnpm@latest` only if that major can't be parsed), so on the normal path it stays within `devEngines`. Because `corepack use` validates the resolved version against `devEngines` **before** writing `packageManager`, an exact `devEngines.packageManager.version` pin (kept exact to avoid the pnpm dual-declaration warning) would otherwise reject any newer patch and block every bump. To avoid that, `latest:corepack` temporarily widens the pin to the bare major before invoking corepack. If the selected release is still inside the registry's minimum-release-age window, the pnpm bump is skipped with a notice instead of failing — the temporary widening is rolled back so `package.json` is left unchanged, and `latest:update` and `audit` still run. When the bump does succeed, `devEngines.packageManager.version` is realigned to the new `packageManager` pin so the two stay in exact match (avoiding the pnpm dual-declaration warning). "Exact" means byte-identical, **`+sha512…` Corepack integrity suffix included** — pnpm compares the two fields as raw strings, so a bare `11.18.0` alongside `pnpm@11.18.0+sha512…` still warns. The suffix is semver build metadata, which range checks ignore, so corepack and pnpm both keep resolving the pin as the plain version.

---

## Git hooks

### `josh prevent-main-commit`

Blocks direct commits to `main`. Installed as a pre-commit hook by `josh init`.

### `josh check-commit-message`

Validates commit message format. Installed as a commit-msg hook by `josh init`.

### `josh secretlint-scan`

Runs [secretlint](https://github.com/secretlint/secretlint) over the paths passed as arguments. Wired into the pre-commit hook by `lefthook/base.yml` as `pnpm josh secretlint-scan {staged_files}`.

It exists because secretlint resolves from the **consumer** project — `josh init` / `josh sync` add it to the consumer devDependencies, since pnpm's isolated `node_modules` never exposes a kit dependency's bin to the consumer's `pnpm exec`. Upgrading kit therefore activates the hook one `josh sync` + `pnpm install` ahead of the binary. A bare `pnpm exec secretlint` turns that window into a hard failure on every commit; this wrapper prints an actionable notice and exits `0` instead:

```text
⚠️  secretlint is not installed — skipping the staged-file secret scan.
   The kit pre-commit hook ships ahead of the dependency it needs.
   Run `pnpm josh sync && pnpm install` to provision it.
```

When secretlint **is** installed the scan runs as normal and its exit code is forwarded, so a detected secret still blocks the commit. Skipping is safe as a fallback because the scan is defense in depth ahead of GitHub push protection and PR-time scanners, not the only gate.

The wrapper owns the CLI flags: `--no-glob` is always passed, because lefthook substitutes literal paths and a SvelteKit route directory such as `(app)` or `[id]` would otherwise reach secretlint's glob engine as a pattern. Secret masking and the `.gitignore` cascade are both on by default in secretlint v13, so no flag is needed for either.

### `josh hook:install`

Install git hooks via lefthook.

```bash
pnpm josh hook:install
```

### `josh hook:uninstall`

Uninstall git hooks.

```bash
pnpm josh hook:uninstall
```

### `josh hook:commit` / `josh hook:push`

Run pre-commit or pre-push hooks manually (useful for debugging).

```bash
pnpm josh hook:commit
pnpm josh hook:push
```

---

## AI tools

Helpers for AI-assisted development workflows.

### `josh prep`

Pre-implementation preparation: reads context and primes the AI for a task.

```bash
pnpm josh prep
```

### `josh issue`

Fetch GitHub issue details for use in an AI-assisted workflow.

```bash
pnpm josh issue 42
```

### `josh epic`

Create the epic issue that tracks a batch of child issues from one split, from the child issue numbers.

```bash
pnpm josh epic "Epic: split the parser work" 101 102 103
pnpm josh epic "Epic: staged rollout" 101 102 --ordered
pnpm josh epic "Epic: ..." 101 102 --rationale-file rationale.md
git log -1 --format=%B | pnpm josh epic "Epic: ..." 101 102 --rationale-file -
```

An epic has four mechanical requirements, three of which fail **silently** when they are got wrong — the epic simply never auto-closes, or an unrecorded batch order is never reported. This command satisfies all four by construction:

| Requirement           | How the command satisfies it                                                        |
| --------------------- | ----------------------------------------------------------------------------------- |
| `epic` label          | ensures the label exists, then creates the issue with it                            |
| task-list child rows  | renders children as `- [ ] #N`, the only syntax the auto-close reads                |
| `Dependencies` form   | the arrow chain with `--ordered`, otherwise the literal `None — the children are …` |
| children-only `queue` | prints the `queue` command from the children; the epic is never included            |

- `--ordered` declares that **the argument order is the dependency order**. The command then writes the arrow chain _and_ applies `gh issue edit <N2> --add-blocked-by <N1>` down the same chain, so the declared order and the native relations come from one input and cannot disagree. Recording the relation needs `gh` >= 2.94.0; when it fails the count is reported and the run still succeeds, because the epic and its task list are already correct.
- `--rationale-file <path>` supplies the split rationale prose; `-` reads stdin, matching `gh issue create --body-file -`. Omitting it leaves a visible placeholder rather than a blank section.
- `--origin <owner/repo#N>` adds the backlink used when the split itself originated in another repository. It is written as prose — a checkbox row referencing another repository disables the auto-close by design.

The manual `gh` procedure remains documented in `prompts/collaboration-workflow.md` as the fallback for environments where `josh` is unavailable.

### `josh epic:check`

Check an existing epic against the same four requirements and report each as pass or fail.

```bash
pnpm josh epic:check 700
```

Exits `0` when every requirement is satisfied and `1` otherwise, so it works as a gate. Use it on epics created by hand, on epics that predate `josh epic`, and after editing an epic body. The checks reuse the very parser the auto-close runs on (`scripts/git/git-epic-parse.ts`), so "what the auto-close can read" and "what this command accepts" are one definition rather than two that can drift.

```
✔ epic label — the `epic` label is applied
✔ child task list — 2 child issue(s) tracked: #101, #102
✖ dependencies section — neither `#N -> #M` nor the `None — ...` literal found; prose order is not machine-readable
✔ auto-close eligibility — every tracked child is in this repository

❌ Epic #700 does not satisfy every requirement.
```
