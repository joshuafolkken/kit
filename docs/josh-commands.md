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

### `josh port`

Print the port this project's dev server or preview server runs on, resolved from `PORT_SEED`.

```bash
pnpm josh port dev       # 5173 with no seed set
pnpm josh port preview   # 4173 with no seed set
```

Those two are for reading the number at a terminal. A `package.json` script that substitutes the number into a command line calls the binary without the `pnpm` wrapper — see the scripts below and the paragraph explaining why.

Every kit-distributed SvelteKit project used to land on the same two ports, so a developer working across several of them on one machine could not run two previews at once — the second project's tooling either collided with the first or drifted onto an unpredictable port. `PORT_SEED` is a personal, non-committed integer in `.env` that offsets both ports together:

```bash
PORT_SEED=1   # dev 5174, preview 4174
```

Unset means seed `0` — today's numbers exactly — so CI and un-migrated projects are unaffected without doing anything. A blank `PORT_SEED=`, the shape `.env.example` ships and the natural way to turn a seed back off, means the same. One seed moves both ports, so a project can never end up with a dev port from one project and a preview port from another. An invalid seed (a non-integer, a negative, or one that would push a port past `65535`) is a hard error rather than a silent fall back to the default: a gate that quietly reverts to the shared port is the collision this exists to remove.

This command and `playwright.config.ts` read one definition and one file. The config imports the same module directly (`import { ports } from '@joshuafolkken/kit/ports'`) and calls `ports.load_environment_file()` before resolving the ports, so the E2E suite follows the seed with no configuration — through `pnpm josh test:e2e`, a bare `pnpm exec playwright test` and the VS Code Playwright extension alike. This command calls the same loader, so the two cannot answer a consumer's `preview` script and its `webServer` with different numbers; in kit 1.85.0 they did, producing `4176` here and `4173` there and costing a consumer its whole E2E suite to a `webServer` timeout. A variable already set in the environment still wins over the file, so `PORT_SEED=2 pnpm josh test:e2e` overrides `.env` for one run.

Two settings cross from `.env` into the process, and no others: `PORT_SEED` and `PLAYWRIGHT_REUSE_SERVER` — the ones kit's own Playwright config reads. `CI` is deliberately excluded even though that config reads it too, because it describes the run rather than the project, and a value pinned in a file would make every local run claim to be CI. The file is parsed in full, by the same reader Node's `--env-file` uses, and every other key it carried is then taken back out of `process.env`. Playwright's `webServer` child inherits the test runner's environment wholesale, so keeping the rest would hand a consumer's `.env` secrets to the dev or preview server for the sake of two settings: a `CLOUDFLARE_API_TOKEN` sitting there is preferred by `wrangler` over the OAuth session it would otherwise use, and one short of the needed scopes turns a working preview into a `403`. A server that wants `.env` loads it in its own start script, which is where that choice belongs.

This narrows what kit 1.87.0 did for the one version it shipped: that release loaded the whole file, so a `webServer` command and any E2E spec briefly saw every variable in `.env`. If a project came to rely on that — a spec reading a test account's password, say — load the file where it is needed rather than through the port loader: `process.loadEnvFile()` in a Playwright [global setup](https://playwright.dev/docs/test-global-setup-teardown) puts it back for the test process without also handing it to the server, and a `set -a; . ./.env; set +a` prefix in the start script does the same for a server that needs it.

The file is looked for at the project root — the nearest directory at or above the working directory holding a `package.json` — and only there. That is the directory `pnpm run` hands a script, so it is the file the `webServer` command and this command both read. A `.env` beside the caller is deliberately not preferred over the root's: letting an `e2e/.env` of unrelated fixture data shadow the seed would re-create the timeout above. Resolving against the working directory alone used to do exactly that, leaving `pnpm exec playwright test` run from a subdirectory on seed `0` while its own server came up seeded.

This command exists for the contexts that cannot import the definition — a `package.json` script substitutes its output into a command line:

```json
{
	"scripts": {
		"dev": "DEV_PORT=$(josh port dev) && vite dev --port $DEV_PORT --strictPort",
		"preview": "PREVIEW_PORT=$(josh port preview) && wrangler dev --port $PREVIEW_PORT",
		"preview:stop": "PREVIEW_PORT=$(josh port preview) && kill-port $PREVIEW_PORT"
	}
}
```

Two details in that shape are load-bearing, and dropping either one puts the substitution back where #825 found it.

**`josh`, not `pnpm josh`.** `pnpm run` already puts `node_modules/.bin` on `PATH`, so the bare binary reaches the same command — and reaches it without a wrapper process writing to the stream the substitution reads. When `node_modules` is older than `package.json`, `pnpm` installs before running and puts the install log and every lifecycle script's output on **stdout**; `josh latest` and a branch switch both leave a tree in that state routinely. And in any project whose `package.json` defines a `josh` script — kit's does, and so does a consumer that wires one — `pnpm josh …` resolves to `pnpm run josh …`, which adds `[ELIFECYCLE] Command failed with exit code 1.` to that same stream when the command fails, so `$(pnpm josh port dev)` hands that sentence to `--port` on an invalid seed. Neither output is something this command can suppress from the inside — they belong to a process kit does not own. Calling the binary directly leaves kit in control of the whole stream, which is what turns "success prints the number and nothing else" from a hope into a promise.

**`VAR=$(...) && cmd`, not the substitution inline.** A failed substitution does not stop the command it feeds: the shell supplies nothing and starts the server anyway, on whatever `--port` then parses as. Assigning first makes the resolver's failure the script's own exit status, so an invalid seed stops at kit's message naming the variable to fix instead of at a vite or wrangler argument error. If a teardown script needs to tolerate "nothing was listening", brace that tolerance — `PREVIEW_PORT=$(josh port preview) && { kill-port $PREVIEW_PORT || true; }` — because a trailing `|| true` binds to the whole chain and forgives the unresolved port along with the absent server.

Success prints the number and nothing else; a missing or unknown argument prints usage to stderr and exits `1`. An unrecognized command name answers the same way — `josh` sends the error line **and** the help listing to stderr — so a script naming a command this kit does not have substitutes an empty string rather than the whole toolkit index.

That listing is where #825 was found, and the remedy for the case that found it lives outside this file: the listing used to go to stdout, so a consumer whose installed kit predated `josh port` had the entire toolkit index substituted into `--port`. A kit old enough to lack the command is also old enough to lack the fix, so the guarantee above covers a mistyped or retired command name on a kit that carries it — not an outdated install. Pair the wiring with a `@joshuafolkken/kit` floor recent enough to have `josh port`.

A busy port still **fails loudly** — nothing retries on another port. Incrementing the seed automatically would re-create the vite drift this replaces and would let a verification gate route silently around a stale server. `--strictPort` is what holds vite to that on the `dev` script: a bare `vite dev --port N` moves to the next free port when `N` is taken, and a dev server quietly on `N + 1` is invisible to Playwright, which waits on the seeded port until `webServer` times out. See [Local E2E aborts with "already used"](./troubleshooting.md#local-e2e-aborts-with-httplocalhost5173-is-already-used).

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

`init` also reports the repository's **Dependabot security updates** setting as its last step, because it writes the same npm-disabling `.github/dependabot.yml` that `josh sync` distributes — a freshly scaffolded private repository has that setting off by default. The line is skipped when the project already had its own `.github/dependabot.yml`, since `init` does not overwrite it and the npm disable never landed. See [`josh doctor`](#josh-doctor) for the four results and [docs/sync.md](./sync.md) for why the setting matters.

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

After a merged run (never on `--no-merge`, where the linked issue is still the current task), right before the final version line, up to five open issues are listed as next-run candidates (`🗒 Next issues (newest first):`), so the next task can be picked straight from the completion output. The newest 20 open issues are fetched and shown newest-first — a newer issue usually encodes the most current understanding of the backlog — excluding the just-completed issue (its `closes #N` close lands asynchronously), `epic`-labeled tracking issues (their children are the runnable work), and `in-progress`-labeled issues already claimed by a workflow. The display is purely informational: when `gh` is unavailable or returns something unexpected, it is skipped silently rather than failing a workflow whose merge already succeeded.

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

#### Release-age holds

An upstream's **effective** install can be behind `Latest:` for a reason no upgrade clears. The repository-managed `.npmrc` sets `minimum-release-age`, which withholds a release from **unpinned** resolution until it has aged past that window. Measured on pnpm 11.22.0 with `minimum-release-age=1440`, against a release published 3.5 h earlier:

```text
pnpm add @joshuafolkken/kit@1.80.0   ->  1.80.0   (pnpm records a minimumReleaseAgeExclude entry)
pnpm add @joshuafolkken/kit          ->  1.78.0
```

So a pinned `Run:` hint always installs and is **never** suppressed. What the window actually holds back is peer resolution — the mechanism behind an upstream's effective install ([#698](https://github.com/joshuafolkken/kit/issues/698)) — which is why the explanation appears there and nowhere else:

```text
@joshuafolkken/app-kit
  Global:  1.78.0      ⚠ → 1.80.0
  Held: 1.80.0 is inside the 24 h minimum-release-age window; an unpinned resolve lands on 1.78.0
  Project:  1.80.0      ✓
  Latest:  1.80.0
```

Since kit publishes several releases a day, a residual `⚠` right after a **successful** `version:upgrade` is the normal case rather than a failure — the `Held:` line says so instead of leaving the marker unexplained. An effective install below what an unpinned resolve reaches is genuinely stale and gets no such line.

The publish timestamps come from the same GitHub Packages endpoint that resolves `Latest:`, fetched only when the effective install is behind `Latest:` and only when a window is actually configured; when they cannot be read the report renders exactly as it did before. `version:upgrade` is unchanged. See [#808](https://github.com/joshuafolkken/kit/issues/808).

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

### `josh ranges`

Check that every dependency range this package **publishes** still resolves for a consumer.

```bash
pnpm josh ranges   # alias: josh r
```

```
✔ 18 published dependency range(s) resolve against the registry.
```

**Why this is not obvious.** `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` governs **pnpm's** `minimum-release-age` and nothing else. The `preinstall` hook installs `@aikidosec/safe-chain`, which applies its **own** age policy and has no knowledge of that list — a package excluded there is still hidden by safe-chain until it ages in. So a dependency floor can be pinned to a release that consumers cannot see, and the install fails naming a version that demonstrably exists and is still tagged `latest`:

```
[ERR_PNPM_NO_MATCHING_VERSION] No matching version found for tsx@4.23.5
The latest release of tsx is "4.23.4".
ℹ Safe-chain: Some package versions were suppressed due to minimum age requirement.
```

An existing lockfile hides this completely — `pnpm install --frozen-lockfile` succeeds because the resolution is already recorded. It only surfaces when a consumer **re-resolves**: `pnpm patch`, adding or removing a dependency, `--no-frozen-lockfile`, or a fresh clone whose lockfile no longer matches configuration.

**How the check works.** For each entry in `dependencies` it runs `pnpm view <name>@<range> version`. Where safe-chain's shims are on `PATH`, that query returns the same **filtered** view a consumer installs under — the policy is observed rather than modelled, so there is no threshold to guess and keep in sync. `devDependencies` are excluded (a consumer never installs them) and so are peer ranges (satisfied from the consumer's own tree).

Dependencies that resolve **outside** the registry — `workspace:*`, `catalog:`, `file:`, `link:`, git URLs — are set aside rather than probed: the registry has no answer for them, and this command also runs in consumer repos where those protocols are ordinary. They are printed, never dropped in silence, because a guard that quietly narrows its own coverage reports success for exactly the dependencies it never looked at:

```
⏭ Not checked — resolved outside the registry: @local/shared@workspace:*
```

A range counts as resolved only when the output contains a version `semver` can parse. "Output is non-empty" is not enough: safe-chain appends its own `ℹ Safe-chain: Some package versions were suppressed…` notice to stdout, so a query that answered nothing still comes back with text. The check **fails closed** otherwise — a probe that cannot answer at all (network error, auth failure) is reported as unresolvable, because a false stop costs one re-run and a false pass publishes a package nobody can install.

**Where it runs, and how strong it is in each place.**

| Trigger                              | safe-chain shims active?                              | Catches                                             |
| ------------------------------------ | ----------------------------------------------------- | --------------------------------------------------- |
| `josh latest`, after `latest:update` | yes, on a developer machine                           | age suppression **and** a floor that does not exist |
| `prepack` (`pnpm publish`)           | no — the publish job installs with `--ignore-scripts` | a floor that does not exist                         |

The `josh latest` run is the primary detector: it fires immediately after the ranges are rewritten, on the machine whose registry view matches a consumer's. The `prepack` run is a backstop — it still blocks a publish, but without the shims it sees the unfiltered registry and cannot tell that a floor is merely being withheld. Run `josh ranges` by hand any time a floor is raised outside those two paths.

Probing a `@joshuafolkken/*` dependency needs `NODE_AUTH_TOKEN` for GitHub Packages. `josh latest` exports it before chaining here (the same prelude `latest:update` relies on), so the composite always has it; a bare `josh ranges` in a project with scoped dependencies needs `export NODE_AUTH_TOKEN=$(gh auth token)` first, or those entries fail closed and are reported as unresolvable.

The probes are one registry request per runtime dependency, run in sequence — a few seconds for a package with a couple of dozen `dependencies`, which is the cost `josh latest` now carries.

**Fixing a violation.** Lower the floor to a release already outside the age window — `^4.23.4` instead of `^4.23.5`. Nothing is given up: the caret still admits the newer version once it ages in, and because `package.json` is the only file that changes, `pnpm install` keeps the already-resolved newer version in the lockfile. Raising the floor further is the intuitive move and the wrong one.

---

## Maintenance

### `josh doctor`

Diagnose — and optionally repair — PATH shadowing of the global `josh`.

```bash
pnpm josh doctor          # alias: josh dr — diagnose only
pnpm josh doctor --fix    # reclaim the global josh by removing a stale kit shim
```

`doctor` reports the running binary, the `josh` first on `PATH` (`which josh`), and the pnpm-global install (`pnpm bin -g`). When the PATH `josh` differs from the pnpm-global one, it prints the same shadowing warning as `josh version` plus the recovery command.

`doctor` also reports the repository's **Dependabot security updates** setting, the prerequisite the distributed `.github/dependabot.yml` depends on once npm version updates are disabled ([#803](https://github.com/joshuafolkken/kit/issues/803)). `josh sync` prints the same line unconditionally, and `josh init` prints it when it actually wrote the config — see [docs/sync.md](./sync.md) for why it runs there too. Unlike those two, `doctor` reports only where the prerequisite exists: it skips the line outside a git work tree, and skips it in a repository that has no distributed `.github/dependabot.yml`. `doctor` diagnoses the global install and is routinely run from a home directory or from a clone of an unrelated project, where a Dependabot warning — and an enabling command aimed at someone else's repository — would be noise. Past that gate it always reports, including when the lookup fails, since a broken or unauthenticated `gh` must surface as `could not be read` rather than as silence. One of four results is printed:

| Result              | Meaning                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`           | Security advisories can open npm pull requests.                                                                                                               |
| `paused`            | The setting is on but paused, so no advisory PR is opened. Resume it from the repository's Security → Dependabot page; the enable API does not clear a pause. |
| `disabled`          | Off — npm advisories open no pull request. The enabling command is printed, addressed at the resolved repository.                                             |
| `could not be read` | The setting could not be queried (a 404, or a token without the scope). Reported as unchecked, **not** as off.                                                |

The check never fails the command: an unreadable setting is GitHub-side state kit cannot verify, not a broken install. `doctor` does not enable the setting either — changing a repository setting is the maintainer's call.

`--fix` is your go-ahead to repair: it reads the shadowing binary and, **only if it is a kit shim** (its body references `@joshuafolkken/kit` or the removed `install-bin` script), removes it so the pnpm-global `josh` reclaims `PATH` precedence. Any other shadowing binary is left untouched and reported for manual review — `doctor` never deletes a file it cannot positively identify as a stale kit shim.

#### Design: per-project installs must not touch the global PATH

A per-project dependency's lifecycle hook (`postinstall` / `prepare`) must **never** write to a shared, user-level `PATH` location. Versions prior to `v0.200.0` shipped an `install-bin.ts` `postinstall` that wrote `~/.local/bin/josh` via `os.homedir()`; a single `pnpm install` in any such old project would silently clobber the global `josh` and point it at that project's stale kit. That shim write was removed in [#446](https://github.com/joshuafolkken/kit/pull/446) and must not return — the current kit installs its global CLI only via `pnpm add -g` (bin under `pnpm bin -g`), and a regression test (`scripts/no-global-shim-write.test.ts`) fails if any lifecycle hook or source file reintroduces a shared-PATH write.

**Migration / cleanup.** Projects pinned `< v0.200.0` still carry the old `install-bin.ts` and will re-create the shim whenever they are reinstalled. Upgrade those projects to `>= v0.200.0` (`pnpm add -D @joshuafolkken/kit@latest`). For one-shot recovery when an old project has re-created the shim, run `josh doctor --fix`.

### `josh overrides`

Check that the dependency overrides have not drifted after a dependency update.

```bash
pnpm josh overrides
```

Run after `pnpm update` or `josh latest` to confirm no override was silently removed.

**Both locations are read.** pnpm 11 declares overrides in the `overrides:` block of `pnpm-workspace.yaml`; `pnpm.overrides` in `package.json` is the legacy location. The check merges the two (a workspace entry wins a key collision, matching pnpm's own precedence) and prints where they came from — `✔ overrides unchanged (2 from pnpm-workspace.yaml)`, or `no overrides found in pnpm-workspace.yaml or package.json` when there genuinely are none. Reading only `package.json` is what let a project whose overrides live in the YAML report a false all-clear ([#740](https://github.com/joshuafolkken/kit/issues/740)), so an empty `pnpm.overrides` is never treated as "no overrides".

`--save` writes the current merged overrides to `.overrides-snapshot.json` (gitignored); later runs compare against it and exit non-zero on any add, removal, or change.

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

Dependabot bumps the runtime workflows under `.github/workflows/` only — its `github-actions` ecosystem cannot scan `templates/` — so an action bump always leaves the templates behind. **This is no longer something you have to fix.** Consumer workflows have their pins resolved from `.github/workflows/*` at the moment `josh init` / `josh sync` writes them, so a stale template ref never reaches a consumer and never fails CI. The command remains available for keeping the committed templates tidy; running it is optional housekeeping, not a step in any workflow. The command errors if a single action is pinned to conflicting SHAs across the runtime workflows.

What _is_ still enforced is that every action used by `templates/workflows/*` also appears in `.github/workflows/*` — an action with no runtime counterpart has no canonical pin to resolve from, so its template ref would ship verbatim. See joshuafolkken/kit#747.

### `josh sync-dependabot-pins`

Automate the template-pin refresh over one or more Dependabot action-bump PRs. For each PR number it checks out the PR branch, runs the same sync as `sync-workflow-pins`, and — when pins drifted — commits the template update and pushes it back to the PR branch, then restores the branch you started on.

> **No longer required to unblock a Dependabot PR.** This command existed because template drift used to fail the kit's own CI, making every action bump a manual fix-up. Pins are now resolved when a consumer workflow is written, so a Dependabot PR that touches only `.github/workflows/**` is green on its own. Use this command when you want the committed templates to read as current — not because a PR is stuck. See joshuafolkken/kit#747.

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

Note what the rollback deliberately does **not** do: the floor that is above the newest allowed version stays in `package.json`, because restoring the tree is the whole point. That pin is fine for this repo — the lockfile still resolves it — but it is unusable for anyone re-resolving against the published package. Catching that is [`josh ranges`](#josh-ranges)' job, not this one.

`latest:update` skips **held-back** and **overridden** packages instead of blindly bumping everything. `typescript` is currently held back at `6.x`: its `7.x` release is the native (Go) port that exposes no `SyntaxKind`, which crashes the type-aware ESLint stack (`typescript-eslint`, `eslint-plugin-sonarjs`, `ts-api-utils`) at rule-load time. The hold-back is removed to fix forward once that stack supports the native API. **Every** package named by an override is also skipped — whether the key carries a version selector (`"some-pkg@>=5": "^4"`) or not (`svelte: ^5.55.7`) — read from **both** the `overrides:` block in `pnpm-workspace.yaml` and `pnpm.overrides` in `package.json`, so an override declared in either place is honoured. Skipped packages are printed as `⏭ Skipping held-back / overridden packages: …`.

An override declares the resolution the project has chosen, so updating that package is never useful and is actively harmful in two ways: past a lower-bound cap the tree stops resolving, and for a bare key `pnpm update --latest` rewrites the `package.json` range and leaves that **raw** range in the lockfile importer instead of the override-applied one. The resolved version is unchanged, but `pnpm install --frozen-lockfile` then rejects the lockfile with `ERR_PNPM_OUTDATED_LOCKFILE` (kit [#744](https://github.com/joshuafolkken/kit/issues/744)).

`latest:update` also reports the overrides verdict itself, so it does not depend on anyone remembering which file to open afterwards: `✔ overrides unchanged (<n> from <file>)` when nothing moved, or `⚠ overrides changed (…)` followed by the added / removed / changed entries.

That verdict covers the overrides **file**; a second check covers the **lockfile**. `latest:update` compares every importer specifier against the overrides that apply unconditionally, and fails the run when one no longer matches:

```
✖ pnpm-lock.yaml no longer honours the overrides — CI cannot install it:
  svelte (importer .): lockfile ^5.56.8, override ^5.55.7

  Restore it with: git checkout HEAD -- pnpm-lock.yaml && pnpm install
```

This exists because no other local gate covers the case. The distributed `pnpm-workspace.yaml` sets `trustLockfile: true`, which makes `pnpm install --frozen-lockfile` pass locally on the very lockfile CI refuses — so lint, `tsc`, cspell, unit and E2E all go green on a tree that cannot be installed. Overrides whose key carries a version selector are not compared: such a key rewrites only the dependents whose declared range matches it, which the lockfile alone does not record.

`latest:corepack` pins pnpm to the newest release on the project's **current major** (derived from `packageManager`), so on the normal path it stays within `devEngines`. The target version is resolved from the registry (`pnpm view pnpm@<major> version`, through safe-chain's age-filtered view) rather than a dist-tag, because pnpm publishes its per-major tag `latest-<major>` only for superseded majors — while the pinned major is the current one, no such tag exists and a tag-based pin would skip on every run. It falls back to `pnpm@latest` only if the major can't be parsed. Because `corepack use` validates the resolved version against `devEngines` **before** writing `packageManager`, an exact `devEngines.packageManager.version` pin (kept exact to avoid the pnpm dual-declaration warning) would otherwise reject any newer patch and block every bump. To avoid that, `latest:corepack` temporarily widens the pin to the bare major before invoking corepack. Since the query runs through the same age-filtered registry view a consumer installs under, a release still inside the minimum-release-age window simply resolves to the previous release; if the registry cannot answer at all, the pnpm bump is skipped with a notice instead of failing — nothing is widened, the pin is left where it is, and `latest:update` and `audit` still run. The same non-fatal skip (with rollback of the temporary widening) applies when corepack itself fails. Whatever the outcome, the run ends by realigning `devEngines.packageManager.version` with the `packageManager` pin so the two stay in exact match (avoiding the pnpm dual-declaration warning). That alignment is **not** conditional on a bump: an up-to-date repository skips the bump on every run, so a manifest that arrived with the two fields out of step would otherwise keep the warning forever (kit#773). It rewrites nothing when they already match, so a run that changes no version still leaves `package.json` untouched. "Exact" means byte-identical, **`+sha512…` Corepack integrity suffix included** — pnpm compares the two fields as raw strings, so a bare `11.18.0` alongside `pnpm@11.18.0+sha512…` still warns. The suffix is semver build metadata, which range checks ignore, so corepack and pnpm both keep resolving the pin as the plain version.

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
