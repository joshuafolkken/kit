# josh CLI — Command Reference

`josh` is available as `pnpm josh` (or `pnpm exec josh`) after running `josh init`. Run `pnpm josh help` to print a grouped summary in the terminal.

## Development

These commands replace the corresponding `package.json` scripts. Consumer projects no longer need to add them manually.

### `josh gate`

Run the completion gate's four checks — lint, type check, spell check and unit tests — **concurrently**.

```bash
pnpm josh gate
```

The four are independent and share no mutable state, so nothing is gained by running them one after another. Measured in kit: 13s (lint), 5s (type check), 2s (spell check) and 11s (unit tests) come to 31s in sequence and about 13s together.

The bigger saving is in round trips. A serial gate stops at the first failure, so a tree with a lint error _and_ a type error costs two full runs to discover. `josh gate` runs every check to completion even when one fails, prints each check as one block in the order above — buffered, never interleaved — and ends with a single summary naming every check that failed:

```
✔ lint (pnpm josh lint)
✗ check (pnpm josh-app check:ci)
…
✗ verification gate failed: lint, cspell
```

Each block's header names the command that ran, not only the check, because the type check's command is resolved per project (below). Re-run a single check while fixing by copying the command from its header; the other three are always `pnpm josh lint`, `pnpm josh cspell:dot` and `pnpm josh test:unit`. The exit code is `1` when any check failed, `0` otherwise.

**Only a check with something to say prints its output.** A green gate prints four header lines and the summary and nothing else — what a passing run has to say is "all four passed", which the summary already says, while the four bodies (vitest's per-file listing among them) run to tens of kilobytes that then sit in the conversation and are re-read on every later turn ([#967](https://github.com/joshuafolkken/kit/issues/967)). The gate runs more than once per Issue, so that is a cost per run rather than per Issue. A failing check keeps its whole output — that is the one time the body is the answer, and one failure does not drag the other three bodies back in. **Two passing cases keep theirs too**: a check that exited 0 _without running_ (`josh test:unit` skips when vitest is absent or the project has no tests, and a gate that ran zero tests must not look like one that ran them all), and a check that passed with warnings (`josh lint` runs eslint without `--max-warnings 0`, so warnings do not fail — but they are still something to read).

```bash
pnpm josh gate --verbose   # every check's output, passing ones included
```

`--verbose` is the exception to the refusal below: the gate consumes it itself rather than forwarding it, so it cannot vanish into a sub-command the way a forwarded flag would. Every other argument is still refused, and the refusal names both the arguments it rejected and the one flag it accepts:

```
josh gate takes no extra arguments — pass them to josh lint or josh check or josh cspell:dot or josh test:unit instead
  refused: --workers=1
  accepted here: --verbose
```

**The type check follows the application layer.** Three of the four checks are always the `josh` sub-command of the same name. The type check is not: a SvelteKit project type-checks with `svelte-check` behind `svelte-kit sync`, and `tsc --noEmit` there both misses every `.svelte` type error and fails on a clean checkout where `./$types` has not been generated. So the step is asked of the project's own toolkit:

1. The toolkit shim is found by walking up from the working directory to a `node_modules/.bin` — the same walk pnpm performs, so a gate typed in a subdirectory resolves the toolkit its sibling checks resolve. It is never found through `pnpm <bin>`, which falls through to a globally installed toolkit and would run a SvelteKit type check on a project that is not one.
2. That binary is run with no subcommand and the usage line it prints is read, the same way the `/verify-ui` skill decides whether a `shot` command exists. A toolkit being installed is not the command existing.
3. The first of `check:ci` (the strict variant a gate wants) then `check` that the usage line names is used; `josh-app` is consulted before `josh-game`.
4. When no installed toolkit names either, the step stays `pnpm josh check`.

A project with no application toolkit — kit itself, a plain TypeScript package — therefore gets `tsc --noEmit`, unchanged. The probe runs concurrently with the other three checks, so it costs no wall-clock of its own.

The refusal message above names the `josh` sub-commands, `josh check` among them; on a project whose type check resolves to a toolkit command, pass that check's arguments to the command its output header names instead.

Like the composite commands below, `gate` forwards nothing to the four sub-commands, so it refuses extra arguments rather than discarding them:

```bash
$ pnpm josh gate --workers=1
josh gate takes no extra arguments — pass them to josh lint or josh check or josh cspell:dot or josh test:unit instead
```

Refactoring still comes **before** the gate, and `/code-review` still comes after it — `josh gate` replaces the four checks between them, not the steps around them.

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

### `josh format:edited`

Format the single file an agent just edited. It is not run by hand: `.claude/settings.json`, which this package distributes, wires it to Claude Code's `PostToolUse` event for the `Edit` and `Write` tools, and Claude Code pipes the tool call to it as JSON on stdin. The command reads `tool_input.file_path` out of that payload and runs `eslint --fix` and then `prettier --write` on that path alone.

```json
"PostToolUse": [
	{
		"matcher": "Edit|Write",
		"hooks": [{ "type": "command", "command": "pnpm josh format:edited", "timeout": 90 }]
	}
]
```

The matcher is the plain alternation rather than an anchored regex on purpose: Claude Code treats a matcher built only from letters, digits, `_`, `-`, spaces, `,` and `|` as an exact list of tool names, and reads anything else as an unanchored regular expression. `Edit|Write` therefore names two tools, while `^(Edit|Write)$` would depend on the regex path being available.

**Why a subcommand rather than a shell one-liner in the settings file.** The settings file is copied verbatim into every consumer, so an inline command would be a second copy of this logic in each of them, un-upgradable and untested. As a subcommand the wiring stays one line and the behavior is single-sourced here.

**eslint first, prettier last.** An `eslint --fix` that removes a now-unused disable directive leaves the whitespace behind it, so a prettier pass before eslint can hand back a file that `prettier --check` then rejects. Prettier having the last word is what keeps the hook's own output passing `pnpm josh lint`. `josh format` keeps the opposite order on purpose: it chains the two with `&&`, and `eslint --fix` exits non-zero whenever a non-autofixable error remains, so eslint first would mean one unused variable anywhere in the tree stops prettier from running at all. Here the two runs are independent, so the ordering is free to be the one that leaves the file correct.

**It never fails.** A `PostToolUse` hook runs after the edit has already landed and cannot undo it, so nothing this command does is worth reporting as a failure: a payload it cannot parse, a path that no longer exists, a file type nothing here formats, and a formatter that exits non-zero on a half-written file all end the run quietly. What eslint could not fix is left for `pnpm josh lint` at the completion gate to report.

**Only files inside the project.** A session can carry additional working directories, and a path in another checkout or a home-directory config file is governed by that tree's rules, not this one's — so anything outside the directory the hook runs in is left alone rather than rewritten to this project's prettier and eslint config. Each formatter is bounded at 25 seconds and the hook entry declares 90, so the script's bound is the one that fires first. Neither number makes a kill safe — `prettier --write` rewrites in place, and any kill can leave the file truncated — but 25 seconds is far beyond what formatting one file takes, so reaching it means something is already wrong.

Only paths that prettier has an opinion about are touched (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.svelte`, `.json`, `.jsonc`, `.md`, `.yml`, `.yaml`, `.css`, `.html`), eslint runs on the code subset of those, `node_modules` and `.git` are skipped at any depth, and `dist` and `build` are skipped only as top-level directories — nested, they are ordinary source (`src/routes/build/+page.ts` is a route, not build output). The cost is one eslint and one prettier start per edit. Measured in a SvelteKit consumer that is about five seconds, and eslint is nearly all of it (4.0s against prettier's 0.4s on the same one-file edit) — eslint's config load dominates, and a single file does not make it cheaper. That is the trade: a few seconds per edit against a whole-project lint run to see what one file's formatter made of it, and against formatting problems arriving in a batch at the end of the work instead of one at a time. The shims under `node_modules/.bin` are spawned directly rather than through `pnpm exec`, which removes two process starts from a chain that already holds `pnpm josh` and tsx.

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

### `josh e2e:retry-check`

Report whether the preview server process died during a failed E2E attempt. Invoked by the `ci.yml` this package distributes, between the two attempts of its E2E job; there is no reason to run it by hand except to see how a captured log would be read.

```bash
pnpm josh e2e:retry-check   # alias: josh er
```

It reads the preview server's debug log — the path `WRANGLER_LOG_PATH` names, `e2e-web-server-logs` by default, a directory or a single file — and looks for wrangler's report of a dead worker: `Error in ProxyController` **and** `Network connection lost.`, both in the same file. An assertion failure produces neither, so a suite that merely failed does not match. The verdict is written to `$GITHUB_OUTPUT` as `crashed`, and announced on the run as a notice.

**It reports a fact; the workflow decides what to do with it.** That split is load-bearing rather than stylistic. The retry step ORs `E2E_RETRY_UNCONDITIONAL` in front of this output, so a push to the default branch retries whatever this command managed to say — its failure withholds a release, and a rule that can stop matching does not belong between a merge and its release ([#783](https://github.com/joshuafolkken/kit/issues/783)). A pull request has no such flag and retries only on the signature, so a genuinely failing suite still reports red on its first attempt ([#872](https://github.com/joshuafolkken/kit/issues/872)). Had the flag been passed down to this command instead, a step that errored — it carries `continue-on-error`, so that it can never be what fails a job — would publish nothing and cost the default branch the retry it must never lose.

**Neither string is a signature on its own, and they must meet inside one file.** `Network connection lost.` sits in the `cause` of every observed crash, but workerd also logs it for any aborted in-flight request, so matching it alone would hand a retry to exactly the failing suite this rule exists to expose. The per-file rule is the same guard one level up: a run that restarted the server leaves one log per attempt, and reading them as one text would let an aborted request in the first meet a proxy error in the second ([#911](https://github.com/joshuafolkken/kit/issues/911)).

**The pair has been read against real logs, not only reasoned about** ([#911](https://github.com/joshuafolkken/kit/issues/911)). It matches all 8 `e2e-web-server-log` artifacts game-kit retains, every one of them a genuine server death; and a run of game-kit's own suite that failed on an assertion with the server healthy throughout produces neither string anywhere in its log. Both logs are committed as fixtures the unit tests read, so a signature that stops describing wrangler's output turns into a red build rather than a silent change of behavior. One marker [#872](https://github.com/joshuafolkken/kit/issues/872) considered is deliberately unused: the bare `✘ [ERROR]` wrangler prints to the console appears in the healthy log too, three times, each an ordinary 404.

**A missing log is deliberately not a crash.** A consumer whose preview script is not wrangler writes nothing there, and reading silence as a crash would retry every failing suite in that project. Both ways of being wrong are cheap, which is what makes a signature acceptable on a pull request at all: a false positive spends one extra E2E run and still reports red, since the second attempt fails too, and a false negative leaves the status quo of a human pressing re-run. Nothing about reading the log is fatal either — a path that is missing, unreadable, or not the shape expected all end at "no crash" rather than at a failed job.

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

The shape rule reads `shell` entries, which leaves one case outside it: a **script** that fans out to several sub-commands and forwards nothing, as [`josh gate`](#josh-gate) does. Such a script refuses for itself, reusing the message above so the two read identically — a `script` entry that runs a single tool still forwards its arguments as before.

---

## Project

Commands for setting up and maintaining a project.

### `josh init`

Initialize config files in a new project.

```bash
pnpm josh init
```

Creates or merges all config files. See [init.md](./init.md) for the full list of files created and merged.

`init` writes nothing and exits non-zero when the project is the distribution package's own repository, for the reason [`josh sync`](#josh-sync) does and through the same check — `init` calls the sync writers directly, and rewrites the project's `package.json` scripts and devDependencies on top of them ([#879](https://github.com/joshuafolkken/kit/issues/879)). See [init.md](./init.md#refused-inside-the-packages-own-repository).

`init` also reports two **repository settings** as its last step, because it writes the two files that depend on them. The **Dependabot security updates** setting backs the npm-disabling `.github/dependabot.yml`, and the **Allow auto-merge** setting backs `.github/workflows/dependabot-auto-merge.yml` — a freshly scaffolded repository has both off by default. Each line is skipped when the project already had its own copy of the corresponding file, since `init` does not overwrite it and kit's change never landed. See [`josh doctor`](#josh-doctor) for the results each report can print and [docs/sync.md](./sync.md) for why the settings matter.

### `josh sync`

Overwrite managed files with the latest versions from the package.

```bash
pnpm josh sync
```

Run after upgrading `@joshuafolkken/kit` to pull in updated AI files, GitHub workflow templates, and other managed files. See [sync.md](./sync.md) for the full list. `sync` also realigns `devEngines.packageManager.version` in `package.json` with the `packageManager` pin so the two never drift apart (a mismatch reintroduces the pnpm `Cannot use both "packageManager" and "devEngines.packageManager"` warning).

`sync` writes nothing and exits non-zero when the project is the distribution package's own repository — inside kit, the copies run backwards and overwrite the source with its own derived templates ([#868](https://github.com/joshuafolkken/kit/issues/868)). See [sync.md](./sync.md#refused-inside-the-distribution-packages-own-repository).

### `josh propagate`

Carry the release this repository just published into every consumer repository checked out next to it ([#863](https://github.com/joshuafolkken/kit/issues/863)).

```bash
pnpm josh propagate                     # alias: josh pg
pnpm josh propagate --dry-run           # report the targets and the steps without touching anything
pnpm josh propagate --skip-publish-wait # for a release already known to be published
```

Any other argument is refused with the usage line rather than ignored — a misspelled `--dryrun` that fell through would run the real write path against every consumer.

`--dry-run` writes nothing, so it also skips the publish wait and downgrades the supplier-side working tree check to a warning: the flag is reached for while work is still in progress, and refusing there would make it useless in exactly that situation.

Publishing a release and consuming it are two different jobs, and only the first is automated: every merge auto-tags and publishes, and then a person opens app-kit, runs the upgrade, syncs the managed files, verifies, and opens a pull request — then does it again in the next consumer. `propagate` is that loop, run once.

**It waits for the publish first.** A merge is not a publish: the auto-tag and publish workflows run _after_ the merge commit lands, so a consumer told to upgrade the moment the pull request merged resolves the previous release. `propagate` polls the registry until **this repository's own declared version** — the one the merge published — actually appears. The target is that exact version, never "something newer": a consumer several releases behind would otherwise be satisfied by any publish at all, including one that predates the change being carried. The wait has a timeout, because a failed publish workflow never produces the version; on timeout, or on a registry that fails several probes in a row, **no consumer is touched at all**. A _single_ failed probe is not that — a rate limit or a 5xx would otherwise end a ten-minute wait seconds into it — so the wait keeps going until the failures are consecutive.

Then, for each consumer in turn:

| Step               | What runs in the consumer's directory                                              |
| ------------------ | ---------------------------------------------------------------------------------- |
| Working tree check | Clean tree, on the default branch, not behind its remote (fetched first)           |
| Upgrade            | `pnpm add -D @joshuafolkken/kit@<version>`, plus kit's lockfile repair             |
| Sync               | `pnpm josh sync`                                                                   |
| Verify             | `pnpm josh lint && pnpm josh check && pnpm josh cspell:dot && pnpm josh test:unit` |
| Open issue         | `POST repos/<consumer>/issues` — the upgrade issue the pull request will close     |
| Pull request       | `pnpm josh git -y "Upgrade @joshuafolkken/kit to <version> #<N>"`                  |
| Return             | `git checkout <default>` and pull                                                  |

**The working tree check comes first because everything after it writes.** The upgrade rewrites the lockfile, the sync overwrites managed files, and `josh git` stages the whole tree — so a consumer with uncommitted work would have that work swept into the upgrade commit and pushed. A consumer that is dirty, parked on a feature branch, or behind its remote is refused before anything touches it. The remote is fetched before that comparison: without it both refs are pre-merge and the check passes in exactly the situation it exists for — the seconds after a pull request merged on GitHub.

**The upgrade pins the exact version that was waited for**, rather than asking for the registry's latest. Asking for latest would defeat the wait: a release published while the run was in flight would be the one every consumer received.

**The issue is opened before the pull request because `josh git` requires one.** It derives the branch name and the `closes #N` line from the issue argument, so an upgrade with no issue could not open a pull request at all. `propagate` therefore **opens a GitHub issue in each consumer repository** — an outward-facing write, and the reason the command is scoped to repositories with the same owner. Merging the pull request closes it. When the upgrade and the sync changed nothing, no issue is opened at all and the consumer is reported as a skip; opening one and then failing on an empty commit is the alternative.

**It is created through REST rather than by running `gh issue create`.** That command goes through GraphQL, which a cloud session is answered 403 for, so propagation could not open the consumer's issue from one at all — while `POST repos/{owner}/{repo}/issues` is served normally (joshuafolkken/kit#1042). The issue body travels over standard input, so its multi-line markdown depends on no shell quoting, and the path names the consumer repository outright rather than relying on the directory the call is spawned in. **That request is bounded in time like every other step**, but by a shorter budget: the other steps go through the step runner and get 30 minutes — enough for a consumer's whole unit suite — while a single REST request gets 60 seconds, and a request that overruns it is reported as a failed step rather than holding the single-threaded runner open forever with no later consumer processed at all ([#1065](https://github.com/joshuafolkken/kit/issues/1065)). **A write that ran out of time is not proof the write did not land** — the request may have reached GitHub before the call was killed. Nothing looks for an issue a previous run may have opened, so a consumer reported as failed at the issue step is checked by hand before the run is repeated, alongside the uncommitted working tree that failure already leaves behind.

**The consumer is returned to its default branch last.** `josh git` leaves the checkout on the feature branch, and the next propagation's working tree check would refuse it for that — the consumer would silently stop receiving releases.

Each step runs the **consumer's own** installed CLI from the consumer's directory, which is why the sync is an ordinary consumer-side sync and [#868](https://github.com/joshuafolkken/kit/issues/868)'s self-sync refusal never fires. Every step inherits its output, so a failure shows what failed rather than only an exit code, and each has a timeout so one hung step cannot hold the whole run open. A consumer stops at its first failing step — a failed verification gate never goes on to open an issue or a pull request — and **one consumer's failure never stops another**: the run continues and reports every consumer at the end, because knowing which consumers took the release is the whole point.

**Which repositories are consumers is read, not listed.** The candidates come from the [repository map](#the-discovered-repository-map), so the owner restriction is inherited rather than restated — propagation _writes_, and a write aimed at somebody else's repository is worse than a read aimed at one. A candidate becomes a target when its own `package.json` declares a dependency on `@joshuafolkken/kit`, which is a fact about the checkout rather than a roster: a new consumer needs no change here, and a consumer that is not a published package at all (joshuafolkken-com) is covered, which a list of downstream package names could not do. Candidates that are not targets stay in the report as skips — a consumer silently missing from a run is the failure this command exists to remove.

| Reported as    | Meaning                                                                                                                                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `✓ propagated` | Checked, upgraded, synced, verified, issue and pull request opened, returned to the default branch. (`would be propagated` in a dry run, which opens nothing.)                                                                                                          |
| `✗ failed`     | A step failed; the step and its reason are named. The other consumers still ran. **A consumer that failed after the upgrade or the sync is left with those changes uncommitted** — its working tree needs clearing before the next run, which will otherwise refuse it. |
| `– skipped`    | Already carries this release, does not depend on the package, had nothing to commit, has no local checkout, or has an unreadable `package.json`.                                                                                                                        |

The skips are kept apart because they mean different things. A repository with no `package.json` at all — a Godot or Rust project sharing the parent directory — is simply _not downstream_, not damaged. A `package.json` that exists but cannot be parsed is reported as unreadable. And a mapped path that does not exist (only `JOSH_REPO_PATHS` can name one, since discovery scans directories that do) is reported, **never cloned**: propagation writes into a working tree, and creating one nobody asked for is not a step this command takes on its own. A consumer that is dirty or out of date is reported as a _failure_ rather than a skip — it was eligible and could not be processed.

**`propagate` runs from the supplier's own repository, and only there** — and only when that repository is itself clean, on its default branch, and not behind its remote. Run from a checkout that is behind, the version it would carry is the _previous_ release, which is already published: the wait would pass and every consumer would be sent to a version that does not contain the change.

That boundary is also the answer to who propagates when several sessions are running at once ([#861](https://github.com/joshuafolkken/kit/issues/861)): in the per-repository concurrency model there is one session per checkout, so the session standing in the supplier repository is the one that runs the command and the rest refuse. It is a convention enforced at the boundary, not a lock — two checkouts of the supplier would both pass it — which is why each consumer is _additionally_ refused unless its own working tree is clean.

Because every merge publishes, propagating per pull request would bury the consumers in bump pull requests. Run it **once at the end** of an epic or a queue; it works standalone all the same.

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

**The CI wait is 32 minutes by default.** The command polls the pull request's checks every 10 seconds and prints each poll (`Checking PR status… (n/193)`). The budget is derived from the CI this package distributes rather than picked as a round number: in `templates/workflows/ci.yml` the longest chain is the `e2e` job's 25-minute cap behind the 2-minute `playwright-image` job it needs, so 27 minutes is the longest run that workflow permits, and five minutes of runner-queue headroom goes on top. A unit test walks the `needs` graph of the workflows this package distributes and fails if any declared budget outgrows the wait, so the two cannot drift apart. A job that declares no `timeout-minutes` — `notify-auto-tag`, and the SonarQube job whose check the wait blocks on — is outside that derivation: GitHub's implicit 6-hour limit is longer than any wait worth having, so an uncapped job is a gap the budget cannot promise to cover rather than a reason to inflate it. A wait shorter than what the workflow itself permits gives up on a run that is still legitimately progressing — which is what the previous 180-second default did in every consumer whose suite includes E2E, making `JOSH_CI_TIMEOUT_SECONDS` something to remember on every invocation and, when it was forgotten, producing a red exit beside a CI that was still running (joshuafolkken/kit#851). A longer budget costs nothing when the checks are fast: polling returns as soon as they settle. **A failing check ends the wait as soon as it fails**, whether or not it is on the required list, and the command exits naming what fell over — `PR checks failed (failed checks: E2E).` A run whose `Checks`, `E2E` or `Security Audit` job goes red therefore reports in the time that job took, not in 32 minutes: previously only a required-list check (`SonarQube` by default, `JOSH_REQUIRED_CHECKS` to change it) ended the wait, because any other failure leaves GitHub reporting the pull request as `UNSTABLE` while the rollup still reads as pending, so the command ran its whole budget out and ended in `Timed out while waiting for PR checks to complete.` without naming a cause (joshuafolkken/kit#990). **This makes the gate report sooner, never looser** — no failing check gains a path to a merge, and the poll loop keeps CodeRabbit exempt under the temporary kit#753 policy, so a red or slow CodeRabbit review does not end the wait unless it has been put back on the required list. (The two-minute look-ahead that runs before the polling fails on any failed check, CodeRabbit's included — but that no longer ends the command: the look-ahead is exactly that, not a gate, so its failure is logged and the run falls through to the polling, where the one evaluator decides. Until joshuafolkken/kit#999 it escaped instead, which killed `followup` before the CodeRabbit exemption could apply at all — visible only on a repository whose checks all finish inside that window, since a slower suite times the look-ahead out first. **One exception keeps its old speed**: a branch with no checks at all fails just as a failed one does, and falling through there would trade a failure reported quickly for the whole budget spent waiting on a required check that is missing rather than pending — so when the pull request's own rollup is definitely empty the failure is rethrown. Definitely is the operative word: an answer that could not be read is not an empty rollup, and falls through like any other. Since joshuafolkken/kit#1028 the look-ahead is the same poll loop with a two-minute budget rather than a `gh pr checks --watch` subprocess — `gh pr checks` goes through GraphQL, which a cloud session is answered 403 for. It asks a deliberately weaker question than the merge gate does — have the checks settled, rather than is the pull request mergeable — and the live per-check table `gh` drew is replaced by the same `Checking PR status…` lines. An empty rollup counts as still waiting _during_ those two minutes, so a pull request whose checks have not registered yet is given time, and is asked once more at the end.) **Three things still run the budget out**, because none of them is a failed check: a required check that never appears at all (`SonarQube` on a repository with no Sonar integration) is missing rather than failed, and nothing distinguishes it from one that has yet to start; and a merge state that never reaches `CLEAN` — a conflict, or a branch protection requiring the branch to be up to date — leaves every check green with nothing to name. and a **standing change request on a pull request whose checks never settle** is now reported at the timeout rather than on the first poll — since joshuafolkken/kit#1043 the review listing is read only on a poll that would otherwise conclude the wait, which is what took the merge gate from four REST requests per poll to three (about 760 down to about 570 across a full 32-minute wait); the run is red either way, so the trade only ever moves a red result later, never a green one earlier. A job skipped by its own `if:` condition counts as passing, so conditional jobs never end the wait either. **What does end it is any non-success conclusion**, `cancelled` and `timed_out` included — the same rule the required list has always followed — so re-running a job you cancelled is no longer picked up by a wait already in progress: run `followup` again once it is green. Before the polling starts, `followup` also runs a two-minute look-ahead, so the worst case end to end is about 34 minutes.

Set `JOSH_CI_TIMEOUT_SECONDS` to a positive number of seconds to override it in either direction; anything else falls back to the default. `followup` runs with `--env-file=.env`, so the variable is read from the project's `.env` as well as from the shell — **a leftover `JOSH_CI_TIMEOUT_SECONDS` left in `.env` as a workaround for the old default keeps overriding the new one**, so remove it after upgrading.

An AI agent driving this command should give the tool call the longest timeout it allows and let the command finish: the wait can outlast a single tool call, and shell backgrounding (`&`) does not survive the call returning.

While inspecting those children it also reports when the epic body declares a dependency chain (`#101 -> #102` under `Dependencies`) but **none** of the children carries a `blocked-by` relation, meaning the batch order was never recorded natively. The declaration is what triggers the check: an epic is created for every split, ordered or not, so its mere existence says nothing about ordering and warning on that alone would fire on every unordered batch. The check is deliberately weak — it never judges the shape of the chain, only its total absence — and it runs on every child's merge rather than at epic close, so the omission surfaces while it can still be corrected.

After the merge, `followup` also closes any completed epic. It looks for open issues labelled `epic` whose markdown task list references the issue this PR closed; when every other child in that list is already closed, the epic is closed with a comment naming its children. The just-closed issue is treated as closed without being queried, because GitHub applies the `closes #N` side effect asynchronously. An epic with a still-open child is left alone, and any failure in this step is reported as a warning rather than failing the run — the PR has already merged by then. A run whose comment landed but whose close was refused does not post a second copy: the announcement ends with an HTML comment marker naming the children it was posted for, and a later run that finds that marker closes without commenting again. The marker renders as nothing, so quoting the announcement in an ordinary issue comment no longer suppresses the next one, and an epic that was reopened and gained a child announces the enlarged batch on its own terms. Two cases are skipped on purpose: an epic whose task list tracks a child in **another repository** is never closed automatically (resolving that child's state would need a different repo, and ignoring it could close the epic while the child is open), and nothing runs at all on a `--no-merge` run, where the linked issue is still open.

After a merged run (never on `--no-merge`, where the linked issue is still the current task), right before the final version line, up to five open issues are listed as next-run candidates (`🗒 Next issues (newest first):`), so the next task can be picked straight from the completion output. The newest 20 open issues are fetched and shown newest-first — a newer issue usually encodes the most current understanding of the backlog — excluding the just-completed issue (its `closes #N` close lands asynchronously), `epic`-labeled tracking issues (their children are the runnable work), and `in-progress`-labeled issues already claimed by a workflow. The display is purely informational: when `gh` is unavailable or returns something unexpected, it is skipped silently rather than failing a workflow whose merge already succeeded.

### `josh notify`

Send a Telegram notification. Used for planning, confirmation, failure, and kickoff-retry alerts.

```bash
pnpm josh notify --task-type planning --issue-url "https://..." --body="- bullet 1\n- bullet 2"
pnpm josh notify --task-type confirmation --issue-url "https://..." --body="Waiting for approval"
pnpm josh notify --task-type failure --issue-url "https://..." --body="Build failed"
```

Task types: `planning` 📋 · `completion` ✅ · `failure` ❌ · `kickoff_retry` 🔄 · `confirmation` ⏸️

**The repository in the header follows the URL the notification carries.** It is resolved in this order: an explicit `--repo-name`, then the repository the `--issue-url` names, then the repository the `--pr-url` names, then the repository the command is run in. The issue title is read from the `--issue-url`'s repository, so one URL is enough to describe an issue anywhere; a `--pr-url` names no issue, so it answers the repository only and no title is read from it (joshuafolkken/kit#994). Only a notification with no usable URL of either kind falls back to the working directory, which is what it always did. This matters wherever a workflow files an issue elsewhere and notifies about it — the upstream-interrupt rule opens the issue with `gh api repos/<owner>/<repo>/issues` and sends a `confirmation` right after, and the header used to name the repository the session happened to be running in while the link pointed upstream (joshuafolkken/kit#903).

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

`doctor` reports the repository's **Allow auto-merge** setting on the same terms, as the prerequisite of the distributed `.github/workflows/dependabot-auto-merge.yml` ([#834](https://github.com/joshuafolkken/kit/issues/834)). Without it `gh pr merge --auto` fails with `Auto-merge is not allowed for this repository`, and every github-actions bump the workflow would have merged sits green and unmerged. The gate here is a workflow containing `gh pr merge --auto`, matched rather than the filename: a consumer's own auto-merge workflow needs the same setting, and a same-named workflow that never calls the command creates no prerequisite at all. `josh sync` prints the line unconditionally, and `josh init` prints it when the workflow is present. One of three results is printed:

| Result              | Meaning                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`           | The auto-merge workflow can enable auto-merge on a Dependabot pull request.                                                                                        |
| `disabled`          | Off — the workflow fails and Dependabot pull requests stay open. The enabling command is printed, addressed at the resolved repository.                            |
| `could not be read` | The setting could not be queried (no admin access, or a failed request). Reported as unchecked, **not** as off — a token without the scope simply omits the field. |

The two reports are independent: a consumer synced before #834 has the Dependabot config and no auto-merge workflow, and a repository that only ever added its own auto-merge workflow has the second prerequisite without the first. When at least one applies, the repository name is resolved once and shared by both. `--fix` does not enable this setting either, for the same reason it does not enable Dependabot security updates.

#### The discovered repository map

`doctor` prints the **repository map** — every checkout on this machine that belongs to the same GitHub owner as the repository the command is standing in, with its local path ([#869](https://github.com/joshuafolkken/kit/issues/869)). Other commands need to know where a sibling repository lives before they can carry a release into it or dispatch a run to it; `doctor` is where a wrong map becomes visible, because the alternative is finding out when a write lands in the wrong checkout.

```text
Repositories (same owner, discovered next to this one):
  joshuafolkken/app-kit   /Users/example/Development/app-kit
  joshuafolkken/kit       /Users/example/Development/kit
```

Discovery is automatic, not registered: `doctor` scans the parent directory of the current repository **one level deep**, reads each work tree's `origin` remote, and keys the map by what that remote says. Four remote spellings all normalize to the same `owner/repo` — `git@github.com:owner/repo.git`, an SSH host alias (`git@github-work:owner/repo.git`), HTTPS with credentials and a trailing slash (`https://user@github.com/owner/repo.git/`), and plain HTTPS. **The directory name is never used as the repository name** — a checkout in a directory called `kit-experiment` whose `origin` points at `game-kit` is mapped as `game-kit`.

**The owner restriction is unconditional and cannot be overridden.** Only repositories whose owner equals the current repository's owner enter the map — the same first-party test the AI documents define. A parent directory routinely holds work belonging to other accounts and organizations, and a map that included them would let tooling file issues against, or push to, a repository that is not yours. Remotes on any host other than GitHub are excluded before the owner is even compared, as are directories with no remote at all.

`JOSH_REPO_PATHS` is the escape hatch for the exceptions — a repository that is not a sibling, or one checked out twice — set in the personal, non-committed `.env`:

```bash
JOSH_REPO_PATHS=joshuafolkken/game-kit=/Users/example/elsewhere/game-kit,joshuafolkken/kit=/Users/example/kit-review
```

Entries are `owner/repo=/absolute/path`, comma-separated, and an override wins over the discovered path for the same repository. It is a way in, never a way around: an override naming a different owner is dropped exactly like a discovered sibling would be, and a malformed entry is dropped rather than failing the command — the printed map is what shows you it did not take effect. Outside a git work tree no map is printed at all, since there is no current owner to anchor it against.

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

### `josh issue:state`

Print one issue's state, labels, and whether it is one a run must stop on — in the spelling the workflow documents compare against.

```bash
pnpm josh issue:state 42
pnpm josh issue:state 42 --repo joshuafolkken/app-kit
```

```
state: CLOSED
labels: in-progress
human_review: no
```

It replaces the two reads the workflow documents used to prescribe — `gh issue view <N> --json state --jq .state` and `gh issue view <N> --json state,labels --jq …` — with one call that answers both. Those go through GraphQL, which a cloud session is answered 403 for, and that read is `epic-child`'s verifier: the whole reason a child of an epic may be delegated is that the parent re-reads the child's state from GitHub rather than trusting the unit's summary ([#1054](https://github.com/joshuafolkken/kit/issues/1054)).

The state is printed as `OPEN` / `CLOSED` / `MERGED`, not as REST's lower-case `open` / `closed`. That mapping is [#1024](https://github.com/joshuafolkken/kit/issues/1024)'s, single-sourced in `scripts/git/git-gh-rest-state.ts` — which is the reason this is a command rather than a `gh api` line written into the documents, where the casing rule would have had to be restated.

- **`human_review:` answers whether the issue carries [`needs-human-review`](#needs-human-review--the-opposite-label)** ([#1132](https://github.com/joshuafolkken/kit/issues/1132)) — a run reads that line rather than matching the label string itself. GitHub keeps the spelling a label was created with, so an issue whose label reads `Needs-Human-Review` is the same label and an eye comparing against the lowercase string misses it; the run then does not stop and the artifact ships, which is the one thing that label exists to prevent. The line is decided through `has_any_label`, the case-insensitive comparison every other workflow label already reaches its decision through. **A run asks once, before implementing** — `epic:next` prints a bare issue number and `fullrun` / `queue` are handed one, so nothing has read the labels by the time work would start, and the check is a call of its own made the moment the number is in hand. The confirmation an `epicrun` makes _after_ a delegated child returns reads the same line for free, but that is too late to decide whether to degrade.
- `--repo <owner/repo>` reads a child in another repository, which a cross-repository epic needs. Its state is a GitHub fact, so no checkout there is required.
- **A non-zero exit is never a state.** A number that resolves to nothing prints `does not resolve`; a read that failed — a rate limit, expired auth, a dropped connection — prints `could not read` and says explicitly that this is not "the issue is open". `gh issue view` exited non-zero with an empty stdout for both, and a loop reading that as "not CLOSED" reports a child as failed because nobody could reach GitHub.

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

- `--ordered` declares that **the argument order is the dependency order**. The command then writes the arrow chain _and_ records the matching `blocked-by` relation down the same chain, so the declared order and the native relations come from one input and cannot disagree. The relation goes through the REST dependencies endpoint (`gh api`), so it does not depend on the `gh` CLI's version ([#1026](https://github.com/joshuafolkken/kit/issues/1026)). That endpoint names the blocker by its **database id** rather than its issue number, and does not check that the id belongs to this repository — so the command resolves the id from the number before writing, and a resolution that fails is a failed relation rather than a relation pointing somewhere else. It is applied **after** the issues exist rather than as part of creating them, which is what keeps a failure costing only the relation: the count is reported and the run still succeeds, because the epic and its task list are already correct.
- `--rationale-file <path>` supplies the split rationale prose; `-` reads stdin, matching the `--input -` the REST writes use. Omitting it leaves a visible placeholder rather than a blank section.
- `--origin <owner/repo#N>` adds the backlink used when the split itself originated in another repository. It is written as prose — a checkbox row referencing another repository disables the auto-close by design.

The manual `gh` procedure remains documented in `prompts/collaboration-workflow/issue-template.md` as the fallback for environments where `josh` is unavailable.

#### `josh epic --promote` — turn an existing issue into an epic

```bash
pnpm josh epic --promote 858 101 102 103 [--ordered] [--rationale-file <path|->] [--origin <owner/repo#N>]
```

The discussion that concludes "this is really three issues" almost always happens _inside_ an existing issue, and that discussion is usually the split rationale itself. Creating a separate epic leaves two issues tracking one topic, so `--promote` **appends** the epic's sections to the issue instead of replacing its body ([#865](https://github.com/joshuafolkken/kit/issues/865)).

Everything else matches `josh epic`: the `epic` label is ensured and applied, the children are rendered as task-list rows, `Dependencies` is written in the machine-readable form, and `--ordered` records the whole `blocked-by` chain. A promoted issue therefore passes `pnpm josh epic:check <N>` exactly as a created one does. `--rationale-file` and `--origin` mean the same thing they do on a creation.

**Re-running it is refused, not repeated.** A second append would leave two task lists in one body, and the auto-close would read whichever it matched first. The check is on the body rather than the label alone, since a label can be applied by hand without the sections.

Promote when the issue is a request, a discussion or a container. When the issue is itself one of the deliverables — a bug report that turns out to need three separate fixes — keep it as a child and create a new epic instead; promoting the report would leave the report with nowhere to live.

**The `Execution` section now prints `epicrun #<E>`**, for both creation and promotion. `epicrun` takes the epic rather than a list of children: it re-reads the state from GitHub each round, so an interrupted run resumes without anyone retyping the remaining numbers, and a child that needs a decision is parked rather than ending the run ([#861](https://github.com/joshuafolkken/kit/issues/861)). Epics created before this change still say `queue …` in that section and are unaffected — nothing reads it, the auto-close reads the task list and `epic:check` never looks at it.

#### `josh epic --add` — insert children into an existing epic

```bash
pnpm josh epic --add 893 894                  # append to the end
pnpm josh epic --add 893 894 --before 891     # #894 must finish before #891
pnpm josh epic --add 893 894 --after 890      # #894 starts once #890 is done
```

Discovering mid-run that something else has to happen first used to have no tool behind it. The procedure said "add it to the epic's task list and record the dependency", but an epic's dependencies live in **three places at once** — and editing the body by hand updates one of them:

| Where it lives                          | What reads it                                     |
| --------------------------------------- | ------------------------------------------------- |
| the `- [ ] #N` task list                | the epic auto-close                               |
| the `## Dependencies` arrow declaration | [`josh epic:next`](#josh-epicnext)                |
| the native `blocked-by` relations       | `epic:next` again, as the authority for execution |

A body edited on its own leaves the declaration and the relations disagreeing, `epic:next` reports `declaration_mismatch`, and its verdict is `error` — which is `epicrun`'s stopping condition 3. So the one command that was supposed to keep an unattended run going stopped it instead ([#890](https://github.com/joshuafolkken/kit/issues/890)). `--add` writes all three from one input.

- **`--before <M>` re-points what `#M` was waiting on.** Inserting `#894` before `#891` in `#890 -> #891 -> #892` drops `#890 -> #891` and records `#890 -> #894` and `#894 -> #891`, so the chain is never left broken. The relations come from diffing the declaration before against the declaration after, which is why the re-pointing needs no special case.
- **No position appends to the end**, and an epic declared unordered **stays** unordered — adding a chain would claim an order nobody declared. Giving a position to an unordered epic starts a chain naming just those two issues; the other children stay unordered, which is what the absence of a chain has always meant.
- **`#M` does not have to be in the declared order.** An epic that mixes ordered and unordered children leaves a child out of every chain legitimately, and a position against such a child adds a **new** chain line beside the existing ones rather than being refused ([#949](https://github.com/joshuafolkken/kit/issues/949)). The chains already declared are left exactly as they were. Before this, the refusal left a prerequisite discovered against an unordered child with nowhere to be recorded, and the documented next step — hand-editing the body — is the one thing this command exists to avoid.
- **`#M` must be a child of the epic**, or nothing is written and the command exits non-zero. That is now the only reason a position is refused.
- **Nothing is written unless all three places will agree.** The rewritten body is parsed back before it is sent, and a round trip that does not reproduce the computed order is reported instead of written. The same holds when the epic **already** records a relation its body never declares: that is reconciled by a person, not guessed at.
- **A declaration the command cannot position within is refused, not rewritten.** `#M` named by two separate chain lines does not identify one place, and a declaration naming the same issue twice is already claiming that issue blocks itself.
- **A declared link that was never recorded is repaired rather than refused.** A body can legitimately run ahead of the relations — an epic written before `josh` recorded them, or one whose recording failed — so `--add` records the missing ones along with its own. A failure is reported as a count while the body stays correct — the same treatment `--ordered` gives it.

**A target that is not an epic is refused with both ways out named.** The message reads `#N does not carry the epic label, so it is not an epic.`, followed by the two remedies: promote it with `josh epic --promote <N> <N...>` when it is a request, a discussion or a container, or create a new epic over both when it is itself one of the deliverables. The command never promotes on its own — promotion rewrites the target into a container, and which arm applies depends on what the target is. Naming both is what keeps the refusal one command away from actionable, which is what the `into <target>` suffix needs of it ([#985](https://github.com/joshuafolkken/kit/issues/985)).

**A cross-repository target is refused with the command to run instead**, not with the usage line. `pnpm josh epic --add joshuafolkken/kit#909 985 --after 970` in the wrong checkout answers with `pnpm josh epic --add 909 985 --after 970` and points at `pnpm josh doctor` for where that checkout is — the children and the positioning flag are carried over from the parsed invocation, so nothing the person typed is silently dropped. `owner/repo#N` is a legal thing to type after `into`, and the answer is a different checkout rather than a different spelling; the usage line would have read as "that form does not exist". **An invocation that is also wrong in some other way still gets the usage line**: the suggestion is only offered when replacing the target with its bare number would parse, so a mistyped positioning flag falls through to the usage line rather than being folded into a suggested command as an extra child. A reference that names **this** repository is not a refusal at all — it is the same insertion written longer, and the command performs it.

**The prose execution block in an epic body is out of scope.** Some epics carry a hand-written list of `epicrun` lines for a person to type in order — a _fourth_ place the order appears, and the only one `--add` does not touch. It has no defined syntax to parse, and [#900](https://github.com/joshuafolkken/kit/issues/900) removes the need for such a block entirely by making a meta epic runnable, at which point `epicrun #<E>` on one line replaces it. Until then, an epic that carries one needs that block updated by hand after an insertion: the declaration and the relations will agree, so `epic:next` reports nothing, and a person typing the old list is the only thing that notices.

### `josh epic:next`

List an epic's runnable children, bundled per repository ([#860](https://github.com/joshuafolkken/kit/issues/860)).

```bash
pnpm josh epic:next 858                            # alias: josh en
pnpm josh epic:next 858 --repo joshuafolkken/kit   # just the next child for one repository
```

Running an epic's children today means handing `queue` a list a person ordered by hand. When a run is interrupted, "where did we get to" is answered by a person reading the issue list again — which is why it cannot be the base of an unattended run. `epic:next` answers it mechanically, and **all of the state lives on GitHub**: there is no local state file, so asking again after any interruption gives the same answer.

**Every runnable child is returned, not one.** The children are bundled by repository so a caller can run one per repository at the same time. Returning a single candidate would close off cross-repository parallelism in the design itself, making the command slower than the person opening several editors it is meant to replace.

```text
Runnable children (one per repository may run at a time):
  joshuafolkken/kit
    #861
    #870
  Waiting on time:
    #862
```

Each bundle names the local checkout a runner would work in, from the [repository map](#the-discovered-repository-map). A repository with no checkout here is reported as `(no local checkout)` rather than cloned.

Every open child appears exactly once in the report, so nothing is silently dropped. A child that could not be read is **not** dropped either — it stops the command. Dropping it is wrong in both directions: an epic whose children all failed to read would look like an epic with no open children, and one missing child leaves whatever it blocks looking unblocked.

**An epic in another repository is referenced as `owner/repo#N`** — `pnpm josh epic:next joshuafolkken/kit#858 --repo joshuafolkken/app-kit`. A bare `#N` resolves to _this_ repository's issue of that number, a different issue entirely, so the qualification is required rather than optional ([#864](https://github.com/joshuafolkken/kit/issues/864)). Children in other repositories are written in the epic's task list as `owner/repo#N` or a full issue URL, and their state is read against that repository through `gh api` — no clone is needed to learn it.

**A `blocked-by` relation that crosses a repository is read as one** ([#1126](https://github.com/joshuafolkken/kit/issues/1126)). REST records and returns such a relation, but the read used to keep only the issue number — and a number alone cannot say which repository it names, since issue numbers are unique per repository. Every blocker was therefore resolved against the **blocked child's own** repository, where it named a different issue or none at all; the graph then dropped it, and the child ran as though nothing blocked it. It also made the publish check below unreachable: every blocker arrived carrying the blocked child's repository, so "same repository" always held and the closed blocker was called resolved without the registry ever being consulted. Relations now carry the repository REST names in `repository_url`, and a relation with none falls back to the repository the issue itself was read in — which is what an unqualified relation has always meant.

`epic:audit` asks a pair of children in two different repositories the same order question as any other pair, which it could not do before ([#1128](https://github.com/joshuafolkken/kit/issues/1128) lifted the exemption that stood while such an order could not be recorded at all). **The finding is a warning rather than an error**: an error fails the audit `epicrun` runs before its first child, so every epic written before this capability existed would stop at step one — [#1010](https://github.com/joshuafolkken/kit/issues/1010) is what that looks like. A pair inside one repository is unchanged and still an error.

**A warning does not make that pair safe, and it is worth being plain about this.** The finding fires exactly when nothing orders the two, so there is no relation for `epic:next` to read and the child is still offered as runnable — it can start before the work it cites. What the change buys is that this used to be silent and is now said. Making it safe would mean stopping, which is what the decision declined for epics that predate the capability. Clearing a warning means recording the relation, and [`josh epic --add`](#josh-epic) cannot write a cross-repository one yet ([#1138](https://github.com/joshuafolkken/kit/issues/1138)) — until it can, that is a `dependencies/blocked_by` request by hand.

**A dependency that crosses a repository is not satisfied when the blocking issue closes.** Merging kit's issue does not publish kit: the merge, the auto-tag and the publish run one after another. A consumer child told it may start at that moment installs the previous release, or fails outright — which surfaces as "it breaks sometimes", the hardest kind to diagnose. Such a dependency resolves only when the blocker is closed **and** the version its default branch declares has appeared in the registry, and the evaluation is an AND **in that order**: while the blocker is still open the registry is never consulted, so a run never sits waiting on a publish from the moment it starts. The target is that exact version, never "something newer" — a consumer several releases behind would otherwise be satisfied by a publish that predates the change. The publish check is [`josh propagate`](#josh-propagate)'s own, shared rather than restated.

**A repository that publishes no package is not something to wait for** ([#1129](https://github.com/joshuafolkken/kit/issues/1129)). The publish check above answers "not yet" forever for a package that will never appear, so a closed blocker in a website repository — anything that ships no npm package — waited until the run's own eight-hour timeout with nothing an operator could edit to clear it. That state only became reachable with [#1126](https://github.com/joshuafolkken/kit/issues/1126).

The answer is read from the **blocker repository's own manifest**, not from the registry: no `package.json` on its default branch, or one declaring `private` that is not a workspace root, means it ships nothing and a closed blocker there is resolved. **A private workspace root is excluded** ([#1134](https://github.com/joshuafolkken/kit/issues/1134)) — such a root is private by convention while the packages under it publish, so reading one as shipping nothing would start a dependent before its blocker's release existed. Only whether the repository _is_ a workspace is asked; the members are not enumerated, so a workspace whose members are all private waits when it need not. **A workspace is what declares members**, not what has a `pnpm-workspace.yaml` — `josh sync` distributes that file to every consumer whatever its layout, carrying `overrides` and the like, so its presence alone would read every private project as a workspace. A workspace file nobody could read leaves the layout unknown and the dependency waiting. That is the safe direction, because waiting ends at the run's own timeout and resolving early does not end at all. Deliberately not the registry, which answers 404 both for a package that was never published _and_ for one this token may not see — a renamed repository, a private package, a missing `read:packages` scope — so resolving on a registry 404 would start a consumer child before its blocker's release existed. A manifest 404 carries no such ambiguity: the repository's issues are already being read, so access is established and what is missing is the file. A read that merely failed is told apart by HTTP status rather than by `gh`'s error text, and keeps the dependency waiting.

With `--repo`, standard output carries exactly one token — the issue number when there is a child to run, otherwise the verdict (`wait`, `stop` or `complete`) — so `answer=$(josh epic:next 858 --repo joshuafolkken/kit)` captures something a loop can branch on. Every explanation goes to standard error. `run` never appears there: it would mean another repository has work, which for this session is something to wait on, so it is reported as `wait`.

**One child per repository, whichever epic it belongs to.** Before `--repo` hands back a number, the repository is asked whether anything is already running in it: if **any** open issue there carries `in-progress` and is not parked, the answer is `wait` and the holders are named on standard error ([#925](https://github.com/joshuafolkken/kit/issues/925)). A parked issue is excluded because `needs-decision` outranks `in-progress` in the classification too, and a run that had just set a child aside would otherwise be held back by it. The contended resource is one working tree, one `main` and one `package.json` that `josh bump` rewrites, and none of them cares which epic a child belongs to — while the classification sorts only the children the epic tracks, so a second `epicrun` in the same checkout used to answer "nothing of mine is in progress" and both ran.

The check is made **only when there is a candidate to offer**: consulted on `stop` or `complete` as well, an unrelated `in-progress` issue would turn a finished epic into a permanent `wait`.

It is advisory rather than atomic. The label is applied by whoever implements the child, _after_ this read, so two sessions starting in the same instant can both see an idle repository; what the check closes is the window that actually occurs, where a session already running a child holds the label for the whole of it. An abandoned label therefore holds the repository until somebody removes it — which is why the holders are named on standard error, and why [`epicrun`](../prompts/collaboration-workflow/epicrun.md)'s stale rule applies to any open issue in the repository rather than to the epic's children alone.

A listing that could not be read is **not** an idle repository — the answer is `wait` rather than the child, since reading a failed read as "nothing is running" is the one direction a guard like this may not fail in. It is not an exit either: the listing swallows a passing rate limit into the same failure, so exiting would end an unattended run over a blip, while a persistent failure is already caught by the unreadable-child anomaly before this read happens.

A listing that was **cut short** lands on the same side ([#1067](https://github.com/joshuafolkken/kit/issues/1067)). Since the paging applies a page ceiling to every listing, a well-formed but incomplete answer with no visible holder is a third thing — and "no holder in the rows I was given" is not "no holder". It answers `wait` too, with its own message: the cause is a listing the paging could not read to the end, so `gh auth status` is green and clearing a stale label would not change it.

**The candidate is confirmed against its own relations listing before it is handed over** ([#1121](https://github.com/joshuafolkken/kit/issues/1121)). A child's blockers are normally read from the issue's `issue_dependencies_summary`, and the listing request is skipped entirely when that summary counts zero — which is what keeps a pass over the whole backlog to one request per issue. The summary is GitHub's own count and it can be wrong: measured on [#1111](https://github.com/joshuafolkken/kit/issues/1111), it read `total_blocked_by: 0` while the listing returned a real, unremovable relation. [#1113](https://github.com/joshuafolkken/kit/issues/1113) re-reads such a child when the epic body _declared_ the missing link, which closes the direction that makes this command exit 1 on a graph with nothing to fix. A relation that was recorded but never declared leaves no trace in the body, so nothing marks the child as a suspect — and there the mistake runs the other way: the child is offered, and an unattended run implements it before its prerequisite.

So the one candidate `--repo` is about to return is asked for its relations directly. When the listing agrees with the summary the child is offered, as before. When it disagrees, that child's blockers are replaced and the whole classification is run again — re-running the classifier rather than testing the listing for emptiness is what makes a blocker that is already closed, or one in another repository whose release has published, come out right without a second copy of those rules. If the child is no longer runnable it is **withheld**, and the next candidate in the same repository is confirmed in its place; a healthy sibling is not made to wait for one child whose counter is stale, because nobody repairs that counter and the wait would never clear. When every candidate is withheld, the verdict is read off the corrected graph.

The cost is one request per candidate confirmed — one in the ordinary case, where the first candidate is offered, and at most the size of the repository's bundle when every one of them is withheld. It is spent only where it can change an answer: **after** the exclusion above, since a busy repository is handed nothing, and not at all when the repository has no candidate. A listing that could not be read withholds the candidate rather than confirming it — "could not tell" is not "nothing blocks it", and this is the one direction the guard may not fail in, because that answer _starts_ work.

**The remaining children are sorted by whether waiting helps — never by which label they carry.**

| Bucket              | What is in it                                                                           | What the caller does |
| ------------------- | --------------------------------------------------------------------------------------- | -------------------- |
| Runnable            | Open, not parked, not already being worked on, and every dependency resolved            | Run it               |
| Waiting on time     | Being worked on elsewhere, waiting on a release, or blocked by something in this bucket | Wait and ask again   |
| Waiting on a person | Carries `needs-decision`, or is blocked by something in this bucket                     | Stop and report      |

Reading the labels instead would fail in a specific, ordinary state. The moment kit's child closes and app-kit's child is waiting for the release to publish, there is no runnable child, nothing carries `in-progress` (kit's child is closed) and nothing carries `needs-decision` (nothing was parked). A label-based reading sees "nothing running, nothing parked" and stops — in the one situation where it should wait.

**Blocking is followed transitively.** A child behind a release-waiting child is waiting on time; a child behind a parked one is waiting on a person, however long the chain. Where both apply, the person wins: waiting would not release a parked blocker whatever the other one does.

The verdict follows from the buckets, and waiting is checked before stopping — a run that stopped while something was still resolving on its own would abandon an epic that was going to finish.

| Verdict  | When                                                              | Exit code |
| -------- | ----------------------------------------------------------------- | --------- |
| run      | At least one child is runnable                                    | 0         |
| wait     | Nothing runnable, but something resolves on its own               | 0         |
| stop     | Nothing resolves on its own; the remaining children need a person | 0         |
| complete | No open child is left                                             | 0         |
| error    | The dependency graph is unusable                                  | 1         |

`--repo` answers `wait` for three things that are not verdicts of the epic at all: the repository is already running something, the `in-progress` listing for it could not be read, and that listing was cut short before it ended. All three are reported on standard error, and none of them changes the exit code — the aggregate form, which does not consult the exclusion, says so there too.

**Whether a dependency is resolved is a replaceable rule.** By default a dependency is resolved once the blocking child is closed. That is not enough across repositories — kit's issue closes before the package is published — so [#864](https://github.com/joshuafolkken/kit/issues/864) replaces the rule with one that also waits for the publish. The extension point is what keeps that condition in one place rather than duplicated per caller.

**Two things stop the command instead of being worked around.**

- **A circular dependency.** Hand-added `--add-blocked-by` edges can make `#1` wait for `#2` while `#2` waits for `#1`, and every session would then wait forever. The children that can never start are named — including the ones stuck _behind_ the cycle, since those never become runnable either.
- **A disagreement between the epic body and the relations.** The body's `Dependencies` section is the human-readable record; the `blocked-by` relations are the authority for execution. When they disagree — an epic written before `josh` recorded the relations, a recording that failed, or a relation hand-added since — the command reports both directions and refuses to pick a winner, because silently following either implements in an order nobody agreed to.

  Only a line that is _nothing but_ a chain counts as a declaration. An epic whose Dependencies section is followed by prose recommending an execution order (`推奨実行順: #869 -> #863 -> …`) is stating a suggestion, not a dependency, and reading those arrows as declarations reported four disagreements against relations that were correct.

The body is parsed through the same module the epic auto-close uses, so "what the auto-close tracks" and "what this command reads" cannot drift apart.

### `josh epic:bundle`

Say whether a newly filed issue belongs with ones already in the backlog ([#873](https://github.com/joshuafolkken/kit/issues/873)).

```bash
pnpm josh epic:bundle 874   # alias: josh eb
```

"Two or more always means an epic" already holds when one request is split on the spot. It does not reach the other way in: two issues filed days apart that turn out to be the front and back of one job are executed separately, in whatever order, with the reasoning recorded nowhere.

Run it right after an issue is filed — by `kickoff`, `fullrun` or `halfrun`, or by any Tier A filing during implementation, including inside an `epicrun`. **The command finds candidates and recommends; it writes nothing.** The machine's job is to surface what it found, not to decide.

**Only two things count as a signal**: the two issues referring to each other in prose, or a `blocked-by` already recorded between them. **A similar title never counts on its own** — "related" expands without limit, and a threshold is what keeps an unrelated issue out of the bundle. The candidate search is [`josh epic:audit`](#josh-epicaudit)'s implicit-dependency analysis, shared rather than repeated: one reads inside an epic and the other across the backlog, but what they read is the same prose references.

An issue belongs to at most one epic, because that is what a task list can express — so there is a branch:

| Candidates                                         | What to do                                                                                     | Tier  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----- |
| **The new issue itself already has an epic**       | Nothing — an issue belongs to at most one, and moving it between epics is not what this is for | —     |
| Already a child of an epic                         | **Add to that epic**; do not create a second one                                               | A     |
| Spread across **different** epics                  | **Stop and ask** — merging epics is not reversible the way adding a child is                   | **B** |
| In no epic, and two or more counting the new issue | **Create an epic** for them                                                                    | A     |
| No strong signal                                   | Nothing                                                                                        | —     |

Bundling is reversible — an epic is editable and a child can be removed — so it needs no confirmation. Merging epics is the one branch that does.

**When the relation carries an order, record it** in `blocked-by` and in the epic's `Dependencies`, on an addition as much as on a new epic: without it the batch survives and the reason it is a batch does not. An order **nobody declared is not invented** — only relations already recorded are carried over.

**A reference the open backlog cannot show is read directly.** The candidate search scans open issues, which left a window of minutes in which the command could answer correctly: a follow-up issue names its parent, and the parent's pull request merges right after — on [#943](https://github.com/joshuafolkken/kit/issues/943) the gap between filing and the parent closing was about three minutes. Past it, `Nothing to bundle.` was printed with exit 0, asserting there was no relation rather than that the command had stopped being able to see one. Every issue number the subject's body names is now read on its own, whatever its state ([#947](https://github.com/joshuafolkken/kit/issues/947)):

- **A closed reference counts only when an open epic already tracks it** — the answer worth recovering is "add it to that epic". Creating an epic over a closed issue would build one whose other child is already finished: nothing for a run to execute.
- **An open reference counts either way** — missing from the listing means the listing was capped, not that the issue is unrelated.
- The lookup is one request per reference, capped per issue and batched like the relation reads. **A read that fails, and a reference the cap never reached, are both reported as gaps** rather than folded into "no relation found" — a guard that truncated in silence would put the command back to asserting there was no relation when it had merely stopped looking.
- **The backlog and epic listings report their own cuts too** ([#1067](https://github.com/joshuafolkken/kit/issues/1067)). Each can stop either because it filled the command's 200-row cap or because the paging reached its 500-row page ceiling, and the `⚠` line names which — the first is a number this command sets, the second is not, so a reader who wants the answer widened is sent to the one that would move. The two listings stay separately reported: what an unseen backlog issue hides is a bundle candidate, and what an unseen epic hides is the epic that already tracks one.
- **A number that turns out to be a pull request is not a candidate.** The issue read answers for one as readily as for an issue, and a merged PR reports a state that is not `CLOSED` — so without the check, "the fix landed in #952" would put a pull request among a proposed epic's children.
- **A number that does not exist is not a gap either** ([#957](https://github.com/joshuafolkken/kit/issues/957)). A typo, or a number belonging to another repository quoted in prose, is dropped in silence — it is neither a candidate nor something the command reports it could not read. Reported as a gap it printed `⚠ Could not read #N.` above the verdict, and [#950](https://github.com/joshuafolkken/kit/issues/950)'s rule — a warning above `Nothing to bundle.` is not an answer, stop and report — then stopped an unattended run for a reference that never existed. **The two are told apart by HTTP status, not by `gh`'s wording**: 404 is nothing at that number, while 403 and 429 are a rate limit and 5xx is the server. GitHub answers 404 rather than 403 for an issue the token may not see, so as not to leak its existence — the two cannot be separated by any reading of the status, and they do not have to be here: the command probes the repository whose open issues it has just listed, so a number it cannot see there is a number that is not there. The read itself does not carry the status — it surfaces a failure as `gh`'s stderr text — so the classification is one extra REST request, spent **only** after a read has already failed and only by the caller that needs the distinction. That last part is why it is opt-in: the backlog's own relation reads cover up to two hundred issues, and a rate limit that failed all of them would spend two hundred more probes finding out why; the classified path is capped at twenty references, so the worst case is twenty.
- Only the subject's own prose is followed. The reverse — a closed issue naming the subject — would mean scanning every closed issue, and is not needed: a follow-up issue naming its parent is what the filing procedure requires.

The whole open backlog is scanned every time. It was thirteen issues when this was written, so there is no index and no cache; add one when the number makes it necessary, not before.

### `josh epic:plan`

Print every child of an epic as one JSON document, so the epic's decisions can be made in one batch ([#862](https://github.com/joshuafolkken/kit/issues/862)).

```bash
pnpm josh epic:plan 858   # alias: josh el
```

Most of the stops an implementation makes could have been answered _before_ it started. Arriving scattered through the run is what forces a person to wait through it, asking per child asks the same question several times, and the answers end up only in a conversation nobody can read back. The output carries each child's number, title, body, labels, `blockedBy` and state.

| Phase      | What happens                                                         |
| ---------- | -------------------------------------------------------------------- |
| 0 — audit  | [`josh epic:audit`](#josh-epicaudit); fix what it finds (Tier A)     |
| 1 — triage | Read the plan; sort each decision into `auto`, `ask` or `defer`      |
| 2 — decide | Put every `ask` to the person **as one question for the whole epic** |
| 3 — run    | `epicrun` runs to the end                                            |

**Phase 0 is not optional.** A batch decision made on a plan that contradicts itself has to be made again once the contradiction surfaces.

Answers are recorded in **both** the epic's `## Decisions` section and a comment on each child they apply to. One without the other leaves either the child's reader without the reasoning or the epic without the decision. **Recording a decision removes that child's `needs-decision` label** — without that, a child stays parked after the answer arrived.

**An epic whose task list tracks nothing is an empty plan, not a failure** — a checked row is still a tracked row, so a finished epic yields closed children rather than an empty list, and an epic that genuinely tracks nothing is a real answer. An epic whose **body could not be read at all** — a bad number, a failed lookup — is a failure, because an empty plan there is indistinguishable from a finished one.

**A child that could not be read makes the command exit non-zero**, not merely warn. It is named on standard error and left out of the plan, and a consumer capturing standard output would otherwise act on a plan missing a child — a decision made without knowing about it.

### `josh epic:audit`

Read an epic's children against each other and report what contradicts what ([#870](https://github.com/joshuafolkken/kit/issues/870)).

```bash
pnpm josh epic:audit 858   # alias: josh ea
```

`epic:check` verifies **one epic's format**. Nothing verified that the children agree — and a hand audit of a real epic found two contradictions that would have stalled the implementation while `epic:check` reported all four of its requirements as passing throughout. Work that only surfaces when a person thinks to go looking for it cannot be the basis of an unattended run.

The graph's own properties — a cycle, and a body declaring one order while the `blocked-by` relations record another — are taken from [`josh epic:next`](#josh-epicnext)'s detection rather than re-derived here. What this command adds is reading _inside_ the children:

| Check                | Level     | What it means                                                                                                                                                                             |
| -------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implicit dependency  | warning   | A child's body names another child of the same epic, and nothing orders the two.                                                                                                          |
| Order contradiction  | **error** | A child's **acceptance criteria** name another child, and nothing orders the two — it can run first. A warning instead once both children are closed, and for a pair in two repositories. |
| Unresolved reference | warning   | A body cites an issue that does not exist, or one already closed.                                                                                                                         |
| Orphan child         | warning   | An issue names this epic as its parent but the epic's task list does not track it.                                                                                                        |
| Orphan search        | **error** | The search for those issues could not read the open backlog — a rate limit, expired auth.                                                                                                 |
| Orphan search        | warning   | That search stopped before the end of the backlog: its 500-issue page cap, or its 50-match cap.                                                                                           |

**Only errors change the exit code.** The implicit-dependency check sees only that one child mentioned another, which is as true of a real missing dependency as of a design note about what comes next. Failing on both would make those notes unwritable, so the machine's job is to stop an omission going unnoticed, not to decide.

**A forward reference the other child already depends on is not reported.** When `#860`'s criteria say `#864` will extend a hook it provides, and `#864` is declared to depend on `#860`, the criteria are satisfiable exactly as written. Verified against a real epic: without that suppression, four of five errors were forward references of that shape.

What remains an error is a name in the acceptance criteria with **nothing ordering the two at all** — the criteria are where a child states what it must deliver, so a deliverable named there that nothing guarantees will exist first is the contradiction. A child citing another purely as an example still trips it; that is the residual cost of a check the machine cannot make semantically, and rewording or declaring the dependency clears it.

**Unless the pair is in two repositories, in which case it is a warning** ([#1128](https://github.com/joshuafolkken/kit/issues/1128)) — such an order only became recordable with [#1126](https://github.com/joshuafolkken/kit/issues/1126), so an error would stop every epic written before it at step one. That warning does not make the pair safe: the child is still offered as runnable, and what changed is that the risk used to be silent. Recording the relation clears it, and [`josh epic --add`](#josh-epic) cannot write a cross-repository one yet ([#1138](https://github.com/joshuafolkken/kit/issues/1138)).

**And unless both children are closed, in which case it is also a warning** ([#1010](https://github.com/joshuafolkken/kit/issues/1010)). The whole force of the error is that the criteria's child _can run first_; once neither child has any execution left, that is no longer true of either, and the finding cannot describe anything that will happen. Left as an error it is permanent — every epic that ever forgot to declare an order fails its audit from then on, and `epicrun` runs the audit before its first child, so the epic stops at step one for a contradiction nothing can trip over. It was confirmed on a real epic: the audit was red while `epic:next` handed back a runnable child perfectly happily.

**Demoted rather than dropped, and the choice was made on the output.** The acceptance criteria are part of the body, so the same pair also matches the implicit-dependency check, which stays quiet only while this one reports the pair. Drop the finding and the pair reappears one line lower as `implicit dependency` — the report is not one line shorter, and the message has lost the one thing worth reading in it, that the name is in the **acceptance criteria**. Since the brevity a drop would buy does not exist, the history stays visible at the level matching what is left to go wrong. Closed is asserted rather than inferred: a state the audit cannot confirm as `CLOSED` (a `MERGED` pull request among them) keeps the error.

**The two `orphan search` findings are about the search, not about the children** ([#1033](https://github.com/joshuafolkken/kit/issues/1033)). The orphan check lists the open issues and matches their bodies client-side; a listing that could not be read used to arrive as an empty result, so a rate limit produced a clean audit that had looked at nothing. It is an error now, and the response is to **re-run the audit** — there is no contradiction to fix and no design choice to park, so neither the Tier A rule below nor a `needs-decision` park applies. If it keeps failing, check `gh auth status` and the rate limit. The warning form means the scan stopped early — at its 500-issue page cap, or once 50 open bodies mentioned the epic — so it covered the newest part of the backlog only; the audit still passes, and an orphan expected further down has to be looked for by hand.

**Run it without being asked** — at the start of an `epicrun`, as [`josh epic:plan`](#josh-epicplan)'s phase 0, and right after a child is added or a dependency changed. **Fixing what it finds is Tier A**: re-pointing a dependency or correcting prose is reversible and will otherwise stall the work, so do it without asking and record the reasoning on the Issue. Park with `needs-decision` only when the contradiction is a design choice nobody has made.

**One thing it cannot check** belongs to the planning step instead. A child introducing a new label, command, state or artifact leaves existing code referencing that concept; three such gaps were found by hand on one epic. List those references and confirm some child owns updating them — label names are single-sourced in `scripts/git/issue-labels.ts`, so consumers can be traced from there.

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

### `josh auto-ok:next`

Print the next opted-in issue an unattended run may pick up outside an epic ([#906](https://github.com/joshuafolkken/kit/issues/906)).

```bash
pnpm josh auto-ok:next                 # alias: josh ao
pnpm josh auto-ok:next --exclude 906   # skip the issue just merged
pnpm josh auto-ok:next --exclude 906,912 --exclude 918   # skip several
```

An epic's task list is not the whole backlog. An issue small enough to need no human judgment sits there forever unless somebody puts it in an epic, so the `auto-ok` label opts one in: [`epicrun`](../prompts/collaboration-workflow/epicrun.md) picks up opted-in issues once the epic's own children are done.

**Only a person applies `auto-ok`.** Typing `epicrun #<E>` approves the merges inside `#<E>` and nothing outside it, and this label is the only way a person extends that approval past the epic's edge — a label an agent could apply to itself would let an unattended run widen its own authorization, which is not a guard at all. An agent typing the command on an explicit instruction in the same turn is executing the person's decision, not making one.

`--exclude <N>` drops issues from the answer. GitHub applies the `closes #N` side effect asynchronously, so for a few seconds after a merge the issue that just shipped is still listed as open — a pickup loop names it here so it cannot be handed back and re-implemented. It takes a comma-separated list and may be repeated, so a loop past its second pickup can name **every** issue it has already run: `closes #N` can fail to fire at all — a reference dropped from a PR body — and the `in-progress` label is not a guard the procedure itself trusts (joshuafolkken/kit#996).

**The `🗒 Next issues` display is not filtered the same way, on purpose.** It is read by a person, who
can see a blocked issue, judge that the blocker is nearly done or does not really block it, and start
anyway; the pickup feeds an unattended run, which has none of that judgement. So the display can name
an issue `auto-ok:next` refuses — the same row is information to one reader and an instruction to the
other (joshuafolkken/kit#1005).

**An issue whose prerequisite is still open is not offered.** The pickup reads the same native `blockedBy` relation `epic:next` builds its graph from, and skips any candidate declaring a blocker that has not closed. `auto-ok` says the issue needs no decision; it says nothing about ordering, so without this an unattended run could start an issue before the work it depends on (joshuafolkken/kit#996).

Standard output carries exactly one token — the issue number, or `none` — so `answer=$(pnpm josh auto-ok:next)` captures something a loop can branch on. Every explanation goes to standard error.

| Answer      | Meaning                                                    | Exit code |
| ----------- | ---------------------------------------------------------- | --------- |
| `<number>`  | Run that issue as a `fullrun`, then ask again              | 0         |
| `none`      | No open issue carries the label                            | 0         |
| _(nothing)_ | The listing could not be read — **not** the same as `none` | 1         |

The command is read-only and never applies or removes the label. It ranks candidates with the same function the `🗒 Next issues (newest first)` display uses at the end of every workflow — newest first, skipping `epic`, `in-progress` and `needs-decision` — so the pickup starts exactly what that list has just named as next. A second ordering would contradict it.

**Opting in is the default absence.** Nothing creates the label, and a repository that does not have it is not an error: `gh` answers an empty listing, the command answers `none`, and an `epicrun` finishes exactly as it did before the label existed. Create it once where it is wanted:

```bash
gh api repos/{owner}/{repo}/labels -f name=auto-ok -f color=0e8a16 -f description="Opted in to unattended execution outside an epic"
```

The listing is capped at 200 issues, and the paging behind it stops after 500 rows whatever the cap says ([#1067](https://github.com/joshuafolkken/kit/issues/1067)). The listing is newest first, so either cut drops the oldest opted-in issues — reported as a `⚠` on standard error rather than ranked silently, because the answer is still an opted-in issue but may not be the one the order promises. The warning names which cut stopped it: a reader who wants the answer widened reaches for the command's own cap in one case and for the paging's ceiling in the other.

### `needs-human-review` — the opposite label

`auto-ok` widens unattended execution past an epic's edge; **`needs-human-review` withholds its last step** ([#1125](https://github.com/joshuafolkken/kit/issues/1125)). An issue carrying it is implemented and taken through the verification gate as usual, and then nothing is committed, pushed, opened as a pull request or merged: the working tree is left uncommitted and unstashed, a `confirmation` notification goes out carrying the resume command, and the run stops there rather than starting the next issue.

It exists for work whose quality no test can judge — a published article, or a choice among generated candidates. Writing "run this with `halfrun`" in the issue body has no force, and pre-applying `needs-decision` is worse than useless: that label stops the issue being **started**, so the artifact a person is meant to look at is never produced.

The two labels sit on opposite sides of a run, and the code says so. `needs-decision` is in `NOT_DIRECTLY_RUNNABLE_LABELS` and in the busy check's parked set; `needs-human-review` is in neither. Excluded from the first it would never be offered; treated as parked in the second, the repository would be handed to the next child while the stopped one's uncommitted work is still in the checkout.

**Only a person applies or removes it**, at the same strength as `auto-ok` — a mark a run can clear for itself is not a mark. Create it once where it is wanted:

```bash
gh api repos/{owner}/{repo}/labels -f name=needs-human-review -f color=d93f0b -f description="Implement and verify, but stop before committing so a person can look"
```

The behavior it triggers belongs to the workflow commands rather than to any `josh` subcommand: [`prompts/collaboration-workflow/human-review-label.md`](../prompts/collaboration-workflow/human-review-label.md) is the canonical definition.

### `josh review:level`

Print the `/code-review` level this change is reviewed at ([#966](https://github.com/joshuafolkken/kit/issues/966)).

```bash
pnpm josh review:level            # the branch diff; alias: josh rl
pnpm josh review:level --staged   # the staged diff
pnpm josh review:level --json     # the level and the reason, machine-readable
```

The level goes to stdout and the reason to stderr, so `$(pnpm josh review:level)` reads the level and a person still sees why.

**The decision takes no judgement.** "This one is small" is a judgement made under cost pressure, and cost pressure resolves it toward "small" exactly when a defect is most likely to be shipped. So the input is the list of changed paths and nothing else, and the rule is a command rather than a paragraph — a rule an agent applies from memory is one it can talk itself out of.

| Every changed path is…                                                                   | Level    | Rounds  |
| ---------------------------------------------------------------------------------------- | -------- | ------- |
| **inert** — `.editorconfig`, `.gitignore`, `LICENSE`, `CHANGELOG.md`, `*.code-workspace` | `low`    | 1       |
| anything else                                                                            | `medium` | up to 2 |

**One non-inert path decides the whole change** — a review reads the change, not a subset of it. An empty diff also takes `medium`: answering `low` to "nothing changed" would hand a reduced level to a caller that failed to read the diff. The branch form counts untracked files too, since `git diff` never lists them and a change that adds a whole new module would otherwise look empty.

**Three things that look inert are not**: `.vscode/**`, `.gitattributes` and `.prettierignore` are all in `package.json`'s `files` and are written into every consumer project by `josh init` / `josh sync`, so a defect in one reaches a consumer. **Documentation is not inert either** — `CLAUDE.md`, `prompts/**`, `.claude/**` and `docs/**` stay at `medium`. The "Non-runtime updates" exception exempts them from _testing_, which asks whether an automated test could have caught the defect; this asks whether a human reading the diff is the only thing that can. Measured on [#963](https://github.com/joshuafolkken/kit/issues/963) and [#965](https://github.com/joshuafolkken/kit/issues/965), both documentation-only by that classification: a `medium` review found ten real defects in each — pointers into removed sections, citations naming the wrong file — in artifacts distributed to every consumer.

### `josh delegate`

Say whether a step of a run may go to a cheaper execution tier ([#969](https://github.com/joshuafolkken/kit/issues/969)).

```bash
pnpm josh delegate gate-fix   # → delegate ; alias: josh dg
pnpm josh delegate review     # → keep
pnpm josh delegate --list     # the enumeration, and what was rejected and why
```

The verdict goes to stdout and the reason to stderr, so `$(pnpm josh delegate <step>)` reads the verdict and a person still sees why.

**The list is the whole of the rule: anything not on the list is `keep`.** A step nobody classified must not be delegated because nobody said it could not be. The direction matters — a missed entry costs money, while a wrong `delegate` costs correctness and does so quietly.

**A step earns its place by naming how a wrong result is caught**, by something that runs in the parent tier and costs less than redoing the step. "Unlikely to be wrong" does not qualify, and most candidates fail here: a notification body, a decision-log comment and a status read all ship their mistakes with nothing left to disagree with them. `--list` shows those as rejected with the reason rather than omitting them, so the next person to propose one finds the answer instead of re-deriving it.

| Step         | Delegatable because                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gate-fix`   | `pnpm josh gate` is re-run; a wrong fix fails it again and the failure names the file                                                                                                |
| `epic-child` | the parent reads the child's state from GitHub rather than from the summary, so a child reported done but not merged is still open — the failure shows instead of the loop moving on |
| `survey`     | the reported locations are checked directly; a fabricated or missed one does not survive one `grep` of what it claimed                                                               |

**These were considered and kept**, so the next person to propose one finds the reason instead of re-deriving it. `pnpm josh delegate <step>` answers `kept deliberately` for these, distinguishing them from a step that is merely unlisted:

| Step               | Kept because                                                                            |
| ------------------ | --------------------------------------------------------------------------------------- |
| `notify-body`      | no verifier; a wrong body is sent and read as though it were right                      |
| `issue-comment`    | no verifier; a decision log or completion comment _is_ the record, so nothing checks it |
| `status-read`      | a misread routes the run to the wrong child and no later step disagrees                 |
| `diagnosis`        | a wrong root cause produces a fix that passes the gate and leaves the defect            |
| `design`           | the cost of a wrong design is paid by every step after it                               |
| `split-assessment` | a missed split widens one Issue into a batch nobody authorized                          |
| `review`           | the review is the last thing between a defect and a merge; a cheaper one finds less     |

**The mechanism is not the unit.** How a thing is delegated is separate from what is delegated — one step of a run, or one whole child of an epic ([#984](https://github.com/joshuafolkken/kit/issues/984)). Both are rows of the one enumeration above rather than two mechanisms, which is why `epic-child` is answered by this same command.

### `josh cost`

Report what a run actually spent, read from Claude Code's own session transcripts ([#962](https://github.com/joshuafolkken/kit/issues/962)).

```bash
pnpm josh cost                  # the newest session — the run that just finished; alias: josh co
pnpm josh cost --session <id>   # one named session
pnpm josh cost --issue 962      # one issue, across every session that touched it
pnpm josh cost --all            # every issue in this project, plus a grand total
pnpm josh cost --json           # the same figures, machine-readable
```

[`josh epicrun`](#josh-epicnext)'s budget guard needs a number it can cite, and until this command there was no way to produce one — nothing read the `usage` Claude Code records for every request, so "did that change make a run cheaper?" had no answer at all.

**A cost is not tokens times one rate.** The four kinds of input are priced differently, and this is not a rounding difference:

| Kind                      | Price         | Why it is kept apart                                                                          |
| ------------------------- | ------------- | --------------------------------------------------------------------------------------------- |
| Uncached input            | base          | The rate the others are multiples of.                                                         |
| Cache write, 5-minute TTL | 1.25x base    | The default TTL.                                                                              |
| Cache write, 1-hour TTL   | **2x base**   | What this project's sessions use — folding it into the 5-minute rate under-reports every run. |
| Cache read                | **0.1x base** | Where nearly all of a long session's input lands.                                             |
| Output                    | 5x base       | Priced from the model's own output rate.                                                      |

Measured on one real request: `cache_read_input_tokens` 97,190 against `input_tokens` 2. An estimate that picked any single rate would be wrong by more than an order of magnitude.

**One API response is written to the transcript as several lines** — one per content block, all carrying the _same_ `usage` object. Measured: 20 assistant lines for 8 requests. The unit of aggregation is therefore `requestId`, never the line; summing lines over-reports a real session by roughly 3x.

**Billed input is split into resident and history.** The resident baseline is the first request's whole input — system prompt, tool schemas, `CLAUDE.md`, the skills index — because that is what was in context before any work happened, and every later request re-reads it. What the run paid for the resident half is that baseline times the request count; the conversation is the remainder. It is an estimate and says so, but the two shares reconstruct the billed input exactly, so a reader can check it.

**Attribution to an issue reads the branch.** `josh git` names a branch `<N>-<slug>`, so the branch carries the issue number — but a child is implemented on the default branch, because `josh git` only creates the branch at commit time. A request made on the default branch is therefore attributed to the nearest issue branch that appears **later** in the same session, falling back to the nearest earlier one for the tail after a merge. Attribution is per session: concatenating sessions first would let one session's trailing branch claim the next session's opening requests.

**The project's transcript directory is its working directory as a slug** — every character that is not a letter, digit or hyphen becomes a hyphen, so `~/Development/my_project` reads from `-Users-…-Development-my-project`. Verified against a real probe: a directory named `slug_probe.dir` produced `slug-probe-dir`.

**`--over <tokens-per-request>` answers a hand-off question instead of printing a table.** It prints `over` or `under` on stdout and the measured figure on stderr, comparing the session's billed input divided by its request count against the limit. Per request rather than in total, because the total only says the session was long — the ratio says what the _next_ turn will cost, which is what a hand-off decision turns on. `epicrun` uses it after each merged child ([#968](https://github.com/joshuafolkken/kit/issues/968)); measured across one run of six children in one context, the figure went from 222k during the first child to 645k during the sixth.

**Nothing is ever silently zero.** An absent transcript exits non-zero and says where it looked — for every scope, `--all` and `--issue` included; a scope with no requests attributed says so in words rather than printing a table of zeroes; a model the price table does not know is reported as unpriced and the total is labelled a floor; and lines that could not be read are counted and printed. Locally generated `<synthetic>` assistant messages are skipped — they were never sent to the API, so counting them would inflate the request count.

### `josh eval`

Run the agent rule-compliance scenarios and report how many held.

```bash
pnpm josh eval                       # every scenario
pnpm josh eval consult-not-execute   # one scenario by name
JOSH_EVAL_MODEL=opus pnpm josh eval  # a different model (default: sonnet)
```

Each scenario replays a representative situation against a real Claude session in a throwaway
sandbox carrying the documents and skills kit distributes, then judges it on the tool calls the run
made — never on what it said. That is what makes it usable for deciding whether a document change
worked: the `n/m` line is a number you can compare before and after an edit, where prose could only
be argued about.

Exits `0` only when every scenario held. It needs the `claude` CLI on `PATH` and is deliberately not
part of CI — every scenario costs tokens and minutes, so it is run when a distributed document,
skill or hook changes. See [docs/eval.md](./eval.md) for the scenario format and how to add one.

The run's last line is a verdict rather than only a count — `held`, `blocked` or `unmeasured` — because
the exit code is `0` only when every scenario passed, so a failed run and one that measured nothing
exit alike. `blocked` stops a merge; `unmeasured` does not, but is reported.

### `josh eval:scope`

Say whether this change has to be measured by `josh eval` ([#907](https://github.com/joshuafolkken/kit/issues/907)).

```bash
pnpm josh eval:scope            # → required | skip ; alias: josh es
pnpm josh eval:scope --staged   # the staged diff
pnpm josh eval:scope --json     # the scope and the reason, machine-readable
```

The scope goes to stdout and the reason to stderr, so `$(pnpm josh eval:scope)` reads the scope and a person still sees why.

**The decision takes no judgement**, exactly as `josh review:level`'s does: the input is the list of changed paths and nothing else. "This edit is only wording" is a judgement made under cost pressure, and cost pressure resolves it toward `skip` at the moment a regression is most likely to ship.

| Any changed path is…                                                                                             | Scope      |
| ---------------------------------------------------------------------------------------------------------------- | ---------- |
| **measured** — `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.claude/skills/**`, `prompts/**`, `.claude/settings.json` | `required` |
| anything else                                                                                                    | `skip`     |

The measured set is derived from what the eval sandbox copies rather than restated here, so it cannot claim a path no scenario reads. **One measured path decides the whole change** — the suite measures the distribution, not the file that changed. **An empty diff answers `required`**: `skip` there would hand a caller that failed to read the diff the same answer as one that measured. The harness and the scenarios themselves (`scripts/eval/**`, `evals/scenarios/**`) do not fire it — changing the ruler is not changing what it measures. `.claude/settings.json` is the one coarse entry: the sandbox drops hooks that invoke the toolchain, so a change to only such a hook answers `required` and no scenario can observe it.

The gate asks about the branch diff. `--staged` is for a pre-commit reading, and the empty-list rule bites hardest there: an empty index answers `required`, which costs five real Claude sessions rather than `review:level`'s free `medium`.

Where the answer is used, what a failure does, and why an epic's completion does not run the suite a second time: [docs/eval.md](./eval.md) → "When it runs".
