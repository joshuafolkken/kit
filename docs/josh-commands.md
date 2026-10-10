# josh CLI — Command Reference

The commands you type by hand — the `developer` audience. Look a command up here rather than reading top to bottom. Commands that need Node tooling (ESLint, `tsc`, Vitest, Playwright) skip in a `basic` project and say why.

See also:

- [Automation command reference](josh-commands-automation.md) — the commands hooks, workflow runs, lanes and maintainers call.
- [Issue, epic, backlog and review command reference](josh-commands-backlog.md) — the commands a workflow run calls to file issues, track epics, plan a backlog and brief a review.
- [Command Catalog](josh-command-catalog.md) — auto-generated index of every command (name, aliases, synopsis, audience, side effects).

`josh` is available as `pnpm josh` (or `pnpm exec josh`) after running `josh init`. Run `pnpm josh help` to print a grouped summary in the terminal. How the dispatcher runs a command in kit's own checkout, and the shape a new script keeps: `docs/maintainers/josh-commands-rationale.md` → "How a command runs".

## Development

These commands replace the corresponding `package.json` scripts; consumer projects need not add them manually.

### `josh gate`

Run the completion gate's checks — lint, type check, spell check, [behavior](#josh-behavior), [unused namespace members](#josh-exportsunused), the [metrics ratchet](#josh-metrics) (kit only) and unit tests — **concurrently**, running all to completion and reporting every failure in one pass.

```bash
pnpm josh gate
pnpm josh gate --verbose   # every check's output, passing ones included
pnpm josh gate --force     # re-run even on a tree already recorded green
pnpm josh gate --no-unit   # the static checks only (CI only)
```

- Static checks: `pnpm josh lint`, `pnpm josh cspell:dot`, `pnpm josh behavior`, `pnpm josh exports:unused`, `pnpm josh metrics` (in kit only); the unit leg is `pnpm josh test:unit`; the type check resolves to a toolkit `check:ci` / `check` when installed, else `pnpm josh check`.
- A tree recorded green is reused unless `--force` or the changed-file map moved.
- **Refuses to start when the scoped pair has not been green on this tree.** A unit-included local gate reads the same record `josh review:brief` does and refuses — naming `pnpm josh lint:related && pnpm josh test:related` — so the first gate is the only gate. It never fires for `--no-unit` (CI has no scoped check in front of it) or `--force`, and `JOSH_SCOPED_GREEN=0` turns it off.
- **On failure, a line per failed check with the command to re-run is printed at the tail**, just above the verdict, so a `tail` of the output keeps every failure and its next action rather than one at a time.
- Exit `1` if any check failed. Refuses any argument other than the three flags.
- The unit leg is the long pole; [`josh test:unit`](#josh-testunit) runs it as a two-project split — same files, less wall clock, not fewer tests.
- **Each check claims a place in a machine-wide weighted core budget before it starts, and waits while the budget is full** (`scripts/gate/core-budget.ts`). The budget is the cores and memory the machine has free, not the bare core count, and a check the wait cap admitted past it is named in the summary. A lone gate is admitted at once with its concurrency unchanged; overlapping gates share the machine instead of each reserving all of it. How the budget is weighted and swept: `docs/maintainers/josh-commands-rationale.md` → "`josh gate`'s core budget".

### `josh lint`

Check code with prettier and eslint.

```bash
pnpm josh lint
```

### `josh lint:related`

Check only the files the change touched — the lint check an implementation loop repeats between edits. Added in front of the whole-tree `josh lint`, never in place of it.

```bash
pnpm josh lint:related
pnpm josh lint:related scripts/thing.ts    # narrow by the given files instead
```

- Changed set = branch diff plus untracked files (cache `.eslintcache.related`); flags are named rather than forwarded (`--fix` is reported ignored).
- Falls back to the whole tree (naming which case) when no changed file is lintable.
- Also runs the fast byte-ceiling check on any changed agent-read document, sharing `document-byte-budget.ts`: a mandated documentation update over its ceiling fails here in seconds rather than at the 80–90-second gate, and the green record is withheld until both lint and the byte check pass.

### `josh lines`

Print how many code lines a file has against the `max-lines` limit and how many remain — so splitting is decided before writing.

```bash
pnpm josh lines scripts/hooks/format-edited-file.ts scripts/josh/josh-logic.ts
```

```
limit 300 code lines · near from 255
scripts/hooks/format-edited-file.ts  230/300 code lines (76%), 70 to spare
```

- Count is lint's own (`skipBlankLines` / `skipComments`); `near from` marks 85%. Never fails on a large file — a non-zero exit means the argument list was unusable.

### `josh bytes`

Print how many bytes an agent-read document has against its recorded byte ceiling and how many remain — the byte counterpart of `josh lines`, so a mandated documentation update that would cross the ceiling is seen right after the edit rather than at the gate.

```bash
pnpm josh bytes docs/josh-commands.md           # one document
pnpm josh bytes                                 # scan: every budgeted document near its ceiling
```

```
docs/josh-commands.md  34492/36864 bytes · 2372 left
entry fullrun  227672/229376 bytes · 1704 left
```

- The scan closes with one row per workflow entry — the **primary** budget (`entry-read-budget.ts`), the total each entry reads against its ceiling — so the main budget is no longer a number the gate reveals only when it fails. The per-document rows above them are the fallback budget, covering the documents no entry reads.
- Path is repository-root-relative (a leading `./` is stripped); a path with no budget entry reads `not counted`.
- The recorded ceiling is block-quantized — the next 4 KB multiple at or above the document's size (`document-byte-budget.ts`), so a document growing within its block needs no ceiling edit and parallel command-adding lanes stop conflicting on this record. An over-budget row names the value to record: the next block multiple, not the raw current size. Never fails — the ceiling is the gate's and `josh lint:related`'s to enforce; a non-zero exit means the argument list was unusable.

### `josh metrics`

Print the repository-wide quality totals no per-function or per-file limit sees — code lines, comment lines and the comment ratio for the non-test files under `scripts/`, the lines of the rule documents (`CLAUDE.md` and `prompts/**/*.md`), the number of `*:guard` commands, and the AI cost in bytes (resident, on demand) — and hold them to the same totals measured on the merge-base.

```bash
pnpm josh metrics                             # print the totals and check them against the merge-base's
pnpm josh metrics --accept --reason "<why>"   # record this branch's growth and why
```

- **A ratchet, and a step of [`josh gate`](#josh-gate).** Exit `1` when the code lines, the comment ratio, the rule lines, the guards or either AI cost grew past the merge-base's, naming each with both values. A total that shrank needs no record: once merged it is what the next branch is measured from. The only way up is `--accept --reason "<why>"`, which writes the growth, the reason and the date to `.josh/metrics-accepted/<issue>.json` — one file per issue, so parallel branches never conflict on it. `JOSH_METRICS_BASE=<commit>` names the commit to measure from where no merge-base can be asked for (CI) — `docs/maintainers/josh-commands-rationale.md` → "`josh metrics`' totals".
- **kit only**: it counts kit's own rule documents and guards, so a consumer's gate leaves the step out.
- Code lines are lint's own `max-lines` count (one lower than `josh lines` on a `#!` file); a comment line is any other non-blank line.
- **Durations** fail past +10% of this machine's baseline; a gate times no startup — `docs/maintainers/josh-commands-rationale.md` → "`josh metrics`' durations".

### `josh format`

Format code with prettier and eslint. A `basic` project without Prettier or ESLint skips that tool for the reason `josh lint` prints.

```bash
pnpm josh format
```

### `josh cspell:dot`

Run spell check, including dotfiles.

```bash
pnpm josh cspell:dot      # includes dotfiles
```

- Runs with `--no-progress`, so it prints only the unknown-word lines and the summary — not the per-file `N/1607 <path> cached` progress that once filled the whole output past the tool's truncation cap.

### `josh behavior`

Check the current run's recorded transcript against the behavior assertions and report where any broke — with **no live Claude session and no model call**. It is one of `pnpm josh gate`'s checks, so behavior regressions are caught every run rather than only by eye.

```bash
pnpm josh behavior
```

- **The data is what every run already writes.** Claude Code files each session's transcript under `~/.claude/projects/**/*.jsonl`; an assertion read off a recorded transcript is deterministic, re-runnable and never calls a model — which is exactly what joshuafolkken/kit#1922 removed the slow five-live-session `josh eval` path for lacking.
- **The scope is the current run, not the whole corpus.** The store holds thousands of transcripts and over a gigabyte; walking all of it every gate would cost minutes. Each gate checks its own run — the newest session transcript, resolved exactly as `josh cost` resolves "the run that just finished" — so across runs the whole corpus is covered a run at a time. The engine stays general, so a broad scan of past runs (how a new assertion is verified green before it is added) is the same walk over a different set of files.
- **A run with no transcript passes** without the skip marker, so a CI runner — which has none — never withholds the gate's green record.
- **The seed set is one assertion**, green across the recorded corpus today: `no-direct-git-index-mutation` — `git add` / `git commit` / `git rm --cached` / `git restore --staged` must go through `pnpm josh git` (dry runs excluded). New assertions are added one at a time, each verified green against past real runs first. A break prints which run and which point it broke at.
- **The manual `josh eval` is untouched**: this restores behavior verification without reviving the live-session path it removed.

### `josh exports:unused`

Report every member of an exported namespace object that nothing in the program reads. It is one of `pnpm josh gate`'s checks, so a dead namespace member fails the gate rather than accumulating.

```bash
pnpm josh exports:unused
```

- **Why its own check**: the namespace convention (`const git_prompt = { confirm_push }` exported as `export { git_prompt }`) keeps the namespace itself imported everywhere, so an ordinary unused-export tool never sees a member nobody calls.
- **Scanned**: `snake_case`, un-annotated object-literal constants exported through a bare `export { x }` in a `.ts` file of the `tsconfig.json` program. An `UPPER_CASE` constant, a type-annotated table, a public `index.ts` entry and a test file declare no namespace it checks.
- **A use is any reference the checker resolves to the member** — a property access, a destructuring, a string-keyed access, or `vi.spyOn(namespace, 'member')` — from any file, tests included.
- **A namespace that escapes whole counts as fully used**: spread, passed as a value, read through a computed key, or re-exported. An alias or a member of another namespace stays tracked.
- Exit `1` with one `path:line  namespace.member` line per finding. Remove the member from its namespace object, and its declaration if nothing in its file uses it either.
- **kit only**: a consumer project reads its namespaces from `.svelte` files and routes this program does not see, so it skips with a notice.

### `josh test:unit`

Run unit tests with vitest. **Skips gracefully (exit 0)** when `vitest` is not installed. Once `vitest` and at least one test file are present, runs `vitest run`.

```bash
pnpm josh test:unit
```

- `vitest` installed with **no** `*.{test,spec}.{ts,js}` file anywhere is a failure, not a skip.
- Guards (kit's own checkout): a unit test that reaches the network or writes into the suite's repository fails; the fix is in the test (mock the read, clear git location env, carry identity on `-c`).
- **The suite runs as two Vitest projects** (`vitest.config.ts`): the classifier's isolation-free files (`scripts/test/pure-files.ts`) run `pure` with `isolate:false` — each shared module evaluated once per worker, not once per file, a measured 57% cut on that set — and the rest run `isolated` with the default. They partition the suite exactly, so **the same files run and the green condition is unchanged**; only the pure ones run faster. The state guard is scoped to `pure`.
- **A setup file silences the real streams for each test body** (`scripts/test/test-stdout-guard.ts`), so a fixture that drives a CLI `main` cannot leak its `process.stdout` lines into the suite's output; `console.*` is untouched and the streams are restored after each test.

### `josh test:related`

Run only the unit tests related to the files the change touched — the unit check an implementation loop repeats between edits. Added in front of the whole `josh test:unit`, never in place of it.

```bash
pnpm josh test:related
pnpm josh test:related scripts/thing.ts    # narrow by the given files instead
pnpm josh test:related --silent            # flags are forwarded to vitest
```

- Changed set handed to `vitest related`; value-taking flags must be `--flag=value`. Falls back to the whole suite (naming which case) when no changed file is importable; a narrowed run matching nothing prints `No test files found` and exits 0.

### `josh test:declared`

Report whether the working-tree change needs a test — `required`, `exempt`, or `satisfied` — from changed paths alone; the same verdict refuses `pnpm josh git -y` on `required` (`prompts/collaboration-workflow/rule-delivery.md`). On `required` the detail names each untested file's type — `E2E` under `src/routes/`, `Unit` elsewhere (`prompts/testing-guide.md` §1) — and then the one command to run next: declare a test for each and verify with `pnpm josh test:declared --match < summary.md`.

```bash
pnpm josh test:declared
pnpm josh test:declared --match   # check Step 0 declarations on stdin
pnpm josh test:declared --help    # print usage, including the --match stdin form
```

An unknown flag is refused with the usage rather than ignored, the same convention `josh time` follows.

`--match` checks each `Test: <type> — <path>` declaration on stdin against the change set, printing `match` / `type-mismatch` / `path-missing` / `test-not-created` per line and exiting non-zero on any mismatch. A path wrapped in a code span, as the template writes it, is read as the path inside it. A `path-missing` line is followed by the changed paths with the same file name, when there are any, and the `report-format.md` section that defines the declaration line's shape.

### `josh test:red`

Run the changed `*.test.ts` files on a temporary merge-base worktree (the pre-fix tree; the working tree and index are untouched) and print `red`, `green`, `no-test` or `test-only`. A change whose every path is a test file prints `test-only` without running anything — the merge-base runs the same code as HEAD, so its result would say nothing about the fix. A change to a doc or `prompts/` file is not test-only, because a document-rule test reads those files. On an Issue declaring `- 種別: 不具合`, `pnpm josh git -y` refuses `green`.

### `josh test:e2e`

Run E2E tests with Playwright. **Skips gracefully (exit 0)** when `@playwright/test` is not installed or no `*.e2e.{ts,js}` files exist. Once both are present, runs `playwright test`.

```bash
pnpm josh test:e2e
```

### `josh test`

Run unit tests followed by E2E tests.

```bash
pnpm josh test
```

`josh test` is a **composite command** and takes no extra arguments — pass runner flags to the stage that understands them:

```bash
pnpm josh test:e2e --workers=1   # ✅ reaches Playwright
pnpm josh test:unit -u           # ✅ reaches Vitest
pnpm josh test --workers=1       # ❌ exits 1, naming test:unit and test:e2e
```

See [Composite commands and extra arguments](#composite-commands-and-extra-arguments).

### `josh check`

Type-check with `tsc --noEmit`. A `basic` project with nothing to check is skipped as `josh gate` does; a listed, uninstalled tool fails. SvelteKit type-checking is not part of kit's framework-agnostic `josh` CLI: SvelteKit projects get `josh-app check` / `josh-app check:ci` from [`@joshuafolkken/app-kit`](https://github.com/joshuafolkken/app-kit).

```bash
pnpm josh check
```

### `josh port`

Print the port this project's dev or preview server runs on, resolved from `PORT_SEED`.

```bash
pnpm josh port dev       # 5173 with no seed set
pnpm josh port preview   # 4173 with no seed set
```

- `PORT_SEED` is a personal `.env` integer; the offset on both ports is `seed × 10 + lane`, where `lane` is `JOSH_LANE_SEAT` (`0` for the main tree).

```bash
PORT_SEED=1   # dev 5183, preview 4183   (seat 0: 1 × 10 + 0)
```

- Distinct seeds stay in disjoint bands (seed 1 is `10..19`), seats `1..9` per project. Invalid seed (non-integer, negative, or above `99`) is a hard error. Only `PORT_SEED` and `PLAYWRIGHT_REUSE_SERVER` cross from `.env` into the process.

A `package.json` script substitutes the output into a command line, e.g. `"dev": "DEV_PORT=$(josh port dev) && vite dev --port $DEV_PORT --strictPort"`.

- Call `josh`, **not** `pnpm josh` (the wrapper writes noise onto the read stream), and use `VAR=$(...) && cmd` so a failed resolve becomes the script's exit status.
- Success prints the number only; a bad argument prints usage to stderr and exits `1`. A busy port fails loudly — `--strictPort` holds vite to it. See [Local E2E aborts with "already used"](./troubleshooting.md#local-e2e-aborts-with-httplocalhost5173-is-already-used).

### Composite commands and extra arguments

A few `josh` commands chain several steps behind one name, implemented as a fixed shell script that cannot expand appended arguments.

**A composite command either forwards extra arguments deliberately, or refuses them. It never ignores them.** Today every composite refuses, exits `1`, and names the sub-commands that accept arguments:

```bash
$ pnpm josh test --workers=1
josh test takes no extra arguments — pass them to josh test:unit or josh test:e2e instead
```

| Composite | Pass arguments to instead                   |
| --------- | ------------------------------------------- |
| `test`    | `test:unit`, `test:e2e`                     |
| `latest`  | `latest:corepack`, `latest:update`, `audit` |

Every other command forwards extra arguments as before. The refusal is driven by the command's **shape**, audited by a unit test on every commit.

#### `VAR=$(...) && cmd`

The assign-then-run shape [`josh port`](#josh-port)'s scripts use: a failed substitution does not stop the command it feeds, so assigning first makes the resolver's failure the script's own exit status instead of a downstream argument error.

## Project

Commands for setting up and maintaining a project.

### `josh profile`

Show the project profile and reason. A saved `josh.profile` takes precedence; `--profile` overrides it. A `basic` project also gets a `compat: profile: static (…)` line, so a `ci.yml` synced before the profiles were renamed ([#2829](https://github.com/joshuafolkken/kit/issues/2829)) still recognizes it.

```bash
pnpm josh profile
```

### `josh start`

Set a new or existing project up for the GitHub Issue workflow, so `kickoff new` works once the setup is on `main`. Use `josh init` for a project without the workflow or for a re-run — [init.md → `josh init` or `josh start`](./init.md#josh-init-or-josh-start) compares the two and lists the steps per starting state.

```bash
pnpm exec josh start                                    # asks for the profile and the repository
pnpm exec josh start --yes --github --profile basic    # unattended, including the GitHub repository
```

**Prerequisites:** the [gh CLI](https://cli.github.com/), installed and signed in (`gh auth login`). Without it `josh start` stops before changing anything.

**Steps**, printed as `[n/N]` while they run:

1. `git init` on `main` — skipped when Git already exists
2. The same setup `josh init` runs, with the confirmed profile
3. The initial commit of every file — only without commits
4. `gh repo create <directory name> --private` (or `--public`) and push `main` — only without an origin
5. The missing workflow and release-classification labels; existing ones are left unchanged
6. The setup pull request — only while `main` has commits but no kit: an Issue, a commit of only kit's files on its branch, and the pull request. It never merges

**Options:** `--profile basic|full` sets the profile instead of asking (the detected one is the default). `--yes` accepts the defaults, but is **not** consent to write to GitHub: when step 4 or 6 is planned, an unattended run without `--github` stops before changing anything. `--public` creates a public repository. Without a terminal, `--yes` is required. `--init-command "<command>"` runs that command as step 2 instead of kit's setup — for a toolkit layered over kit, e.g. `"josh-app init"`. It runs without a shell, with `--profile <confirmed profile>` appended; its non-zero exit stops before the commit, and step 6 also commits every file changed since it ran.

**Existing state:** with a GitHub origin, nothing replaces it and `main` is never pushed to. After a failed commit hook, a re-run on the setup branch resumes step 6. A non-GitHub origin, or commits on a branch other than `main`, is refused before any change.

**Output / exit codes:** exits 0 when every step has run. A failed step exits 1 and prints the step it stopped at, the completed steps and the cause.

### `josh init`

Initialize project config, selecting a profile and reporting applicable repository settings.

```bash
pnpm josh init   # create/merge config files, install and format (--no-install skips both)
```

**Output / exit codes:** exits non-zero inside the distribution package's own repository, where it writes nothing, and when its `pnpm install` fails. In Git, while the checked-out commit lacks kit, it ends by pointing at [`josh start`](#josh-start).

See [init.md](./init.md) for the full file list and [`josh doctor`](#josh-doctor) for the settings reports.

### `josh registry:migrate`

Migrate an existing project from GitHub Packages to public npm. Prints the current registry and proposed change, checks that every locked `@joshuafolkken` package (kit, `app-kit` and the rest) has its exact version on public npm, then updates the project `.npmrc` and rewrites the lockfile entries of all of them. It leaves user-level configuration and any `//npm.pkg.github.com/:_authToken=` line untouched and restores both project files if dependency resolution fails.

```bash
pnpm josh registry:migrate
```

**Output / exit codes:** exits non-zero without changing settings when a locked scoped package version is unavailable on public npm, configuration is ambiguous, or the resolved lockfile still points to GitHub Packages. Re-running a completed migration is a no-op. See [authentication.md](./authentication.md) for the setup being replaced.

### `josh sync`

Overwrite managed files with the latest versions from the package. Run after upgrading `@joshuafolkken/kit` to pull in updated AI files, workflow templates, and other managed files. Also realigns `devEngines.packageManager.version` with the `packageManager` pin, and creates missing labels as [`josh start`](#josh-start) does.

```bash
pnpm josh sync   # overwrite managed files
```

**Output / exit codes:** exits non-zero inside the distribution package's own repository, where syncing would overwrite the source with its own derived templates.

See [sync.md](./sync.md) for the full file list.

### `josh adopt`

Upgrade every `@joshuafolkken/*` toolkit installed in **this** repository to latest, sync each one's managed files, verify, and open the issue and pull request. The consumer-side counterpart of [`josh propagate`](josh-commands-automation.md#josh-propagate), sharing the same step order.

```bash
pnpm josh adopt
pnpm josh adopt --dry-run # report the steps without touching anything
```

**Options:**

- `--dry-run` — report the plan without writing.

Steps, in this repository's directory: working-tree check, `pnpm add -D <toolkit>@latest` (once per installed toolkit, base tier first), `pnpm josh sync` per toolkit's own CLI, verification gate ([`josh gate`](#josh-gate)), open issue, `pnpm josh git`, return to default branch.

**Output / exit codes:** exits `0` on a skip (no toolkit declared, or all current with no file changed). Refused inside kit's own repository, when a runnable toolkit is missing or declared under `dependencies`, or when `@joshuafolkken/kit` is not a direct dependency. Stops at the open pull request — merging is [`josh followup`](josh-commands-automation.md#josh-followup)'s job.

---

## Workflow

AI-assisted git and notification helpers used in the day-to-day development loop.

### `josh git`

Interactive AI-assisted git commit workflow: stages changes, generates a commit message, opens the pull request, and optionally pushes. When no issue argument is given, the issue number and title are derived from the current branch name (`<N>-<slug>`).

```bash
pnpm josh git                            # interactive
pnpm josh git -y                         # unattended (no TTY required)
pnpm josh git -y "title"                 # set commit message prefix
pnpm josh git -y "<title> #<N>"          # follow-up commit on the same branch
pnpm josh git -y --skip-commit --skip-push  # open the PR without committing/pushing
```

**Options:**

- `-y` / `--yes` — run non-interactively; works without a TTY (agent or CI shell).
- `--skip-commit` / `--skip-push` — recover/open a PR without a new commit or push.

**Behavior:** returns as soon as the PR is open and prints its URL — it does not wait for checks (`josh followup` does). Re-running on the same branch makes a follow-up commit and reuses the open PR. Each push is bounded at 120 s and retried once on timeout, the failure naming the command to re-run by hand.

Related: [`josh followup`](josh-commands-automation.md#josh-followup), [`josh pr`](#josh-pr).

### `josh pr`

Create the pull request for the current issue branch — a recovery/standalone counterpart to `josh git` for when the branch is already committed and pushed. It derives the issue number and title from the branch name (`<N>-<slug>`) and generates the `closes #N` line.

```bash
pnpm josh pr   # open the PR for the current <N>-<slug> branch
```

**Behavior:** reports an existing open PR for the branch instead of opening a second one.

### `josh review:findings`

Count the recorded review findings by category — the reader over what `josh review:record` wrote. It reads the observation ledger, tallies each recurring category most-frequent-first, and prints the number of zero-finding rounds, which tells a genuinely quiet category apart from one nobody looked at.

```bash
pnpm josh review:findings
```

**Behavior:** counts only `- rf:` lines, ignoring the `- k:` observation lines in the same file. The `none` sentinel lines are excluded from the category tally and reported as the zero-finding round count instead. A ledger with no finding lines prints `no review findings recorded yet`.

Related: [`josh review:record`](josh-commands-automation.md#josh-reviewrecord).

### `josh main:sync`

Checkout the default branch and pull the latest changes with `git pull --ff-only` (the strategy is named by the command, not read from git config).

```bash
pnpm josh main:sync
```

**Behavior:** refuses inside a linked work tree (a lane) and exits non-zero — run it in the primary checkout instead; a lane's terminal step is `pnpm josh lane:close <issue-number>`. A default branch that has diverged fails loudly under `--ff-only` rather than growing a merge commit — the deliberate opposite of [`josh main:merge`](#josh-mainmerge). The same `--ff-only` pull is used by [`josh git`](#josh-git) and `josh pr` when they start from the default branch. After the pull it runs `git fetch --prune` and deletes, with `git branch -d`, every local branch whose remote-tracking upstream is `[gone]`, that is merged into the default branch, and that no work tree has checked out — a lane's branch, an unmerged branch, a branch with no upstream and a branch with a deleted local upstream are kept. It prints how many it pruned and names any `git branch -d` refused.

### `josh main:merge`

Bring the repository's default branch into the branch this checkout is on: fetches `origin/<default>` and merges it into the current branch.

```bash
pnpm josh main:merge
```

**Behavior:** the merge strategy is named by the command rather than read from git config, so a diverged branch — the state the command exists for — merges cleanly instead of aborting with `fatal: Need to specify how to reconcile divergent branches`. Merging (not rebasing) avoids the force push the distributed `.claude/settings.json` denies. A conflict or uncommitted work on an incoming path fails; commit via `pnpm josh git -y`.

---

## Versioning

### `josh version`

Show the global-install version, the current project version, and the latest published version — plus the **running binary** (the install that actually executed, resolved from `import.meta.url`), the single source of truth for which `josh` produced the report. A not-installed target reports `not installed`; a stale one gets a `Run:` hint with the upgrade command. A release inside the `pnpm-workspace.yaml` `minimumReleaseAge` window prints a `Held:` line. When the `josh` first on `PATH` is not the pnpm-global install, a PATH-shadowing warning names both paths and points to [`josh doctor --fix`](#josh-doctor).

```bash
pnpm josh version
pnpm josh version --upgrade   # upgrade global + project to latest, then re-run fix-gh-packages
```

**Options:**

- `--upgrade` — upgrade both the global install (`pnpm add -g`) and the project devDependency (`pnpm add -D` + `fix-gh-packages`); already-current or not-installed targets are skipped.

### `josh ranges`

Check that every dependency range this package **publishes** still resolves for a consumer. For each `dependencies` entry it runs `pnpm view <name>@<range> version` under safe-chain's shims, so the age-filtered view a consumer installs under is observed rather than modelled. `devDependencies`, peer ranges, and non-registry protocols (`workspace:*`, `catalog:`, `file:`, `link:`, git URLs) are set aside and printed, not probed.

```bash
pnpm josh ranges
```

**Output / exit codes:** fails closed — a range resolves only when the output contains a `semver`-parsable version; a probe that cannot answer (network, auth) is reported unresolvable. Probing `@joshuafolkken/*` dependencies needs `NODE_AUTH_TOKEN` — run `export NODE_AUTH_TOKEN=$(gh auth token)` first for a bare invocation. To fix a violation, lower the floor to a release already outside the age window (e.g. `^4.23.4` instead of `^4.23.5`).

---

## Maintenance

### `josh doctor`

Diagnose — and optionally repair — PATH shadowing of the global `josh`.

```bash
pnpm josh doctor          # diagnose only
pnpm josh doctor --fix    # reclaim the global josh by removing a stale kit shim
pnpm josh doctor --ports  # also print the per-repository port-seed table
```

`doctor` reports the running binary, the `josh` first on `PATH` (`which josh`), and the pnpm-global install (`pnpm bin -g`), warning when the two differ and printing the recovery command. In a kit consumer it also prints a **Consumer setup** section — one-line `✓` / `⚠` verdicts for the kit plugin, git `core.hooksPath`, `CLAUDE.md`, and secretlint — plus the repository's **Dependabot security updates** and **Allow auto-merge** settings (`enabled` / `disabled` / `could not be read`; auto-merge also `paused`) and, where a distributed workflow is present, the **Required status checks** report of [`josh ruleset:check`](josh-commands-automation.md#josh-rulesetcheck). None of these ever fail the command, and `doctor` never changes a repository setting.

**Options:**

- `--fix` — remove a shadowing binary **only if it is a kit shim** (its body references `@joshuafolkken/kit` or the removed `install-bin` script); any other binary is left and reported for manual review. Also the one-shot recovery for an old project that re-created the global shim.
- `--ports` — additionally print the port-seed table (see below).

#### The discovered repository map

`doctor` prints the **repository map** — every checkout on this machine that belongs to the same GitHub owner as the current repository, with its local path — so other commands can locate a sibling before writing into it.

```text
Repositories (same owner, discovered next to this one):
  joshuafolkken/app-kit   /Users/example/Development/app-kit
  joshuafolkken/kit       /Users/example/Development/kit
```

Discovery is automatic: `doctor` scans the parent directory one level deep, reads each work tree's `origin` remote, and keys the map by that remote's normalized `owner/repo` (SSH, host-alias SSH, credentialed HTTPS, and plain HTTPS all normalize the same). **The directory name is never used as the repository name** — a checkout in `kit-experiment` whose `origin` points at `game-kit` maps as `game-kit`.

**The owner restriction is unconditional and cannot be overridden.** Only repositories whose owner equals the current repository's owner enter the map, so tooling can never write to someone else's repository. Remotes on any host other than GitHub are excluded before the owner is even compared, as are directories with no remote at all.

`JOSH_REPO_PATHS` is the escape hatch for non-sibling or twice-checked-out repositories, set in the personal `.env`:

```bash
JOSH_REPO_PATHS=joshuafolkken/game-kit=/Users/example/elsewhere/game-kit,joshuafolkken/kit=/Users/example/kit-review
```

Entries are `owner/repo=/absolute/path`, comma-separated; an override wins over the discovered path for the same repository. It is a way in, never a way around: an override naming a different owner is dropped exactly like a discovered sibling would be, and a malformed entry is dropped rather than failing the command. Outside a git work tree no map is printed, since there is no owner to anchor it.

With `--ports`, `doctor` additionally prints each discovered repository's **port seed** and its resolved dev / preview ports, and flags any seed held by more than one repository:

```text
Port seeds (dev / preview, and repositories sharing one):
  joshuafolkken/app-kit   seed 0   dev 5173   preview 4173
  joshuafolkken/kit       seed 1   dev 5183   preview 4183
  ⚠ seed 0 is shared by: joshuafolkken/app-kit, joshuafolkken/game-kit
```

It never rewrites a `.env` — the seed is a personal per-machine setting, so the report names the clash and a person resolves it. A malformed seed is reported as `PORT_SEED could not be read`.

### `josh audit`

Run a security audit against the lockfile.

```bash
pnpm josh audit
```

The scanner is looked up on `PATH` first, then in the `josh audit:provision` cache (`node_modules/.cache/josh-tools/`). With neither present the audit exits non-zero and prints how to get one — it is never skipped or weakened.

### `josh overrides`

Check that the dependency overrides have not drifted after a dependency update.

```bash
pnpm josh overrides           # verify overrides unchanged
pnpm josh overrides --save    # snapshot current merged overrides
```

Checks effective overrides from `pnpm-workspace.yaml` against a saved snapshot and reports ignored `pnpm.overrides` entries in `package.json` separately. pnpm 11 and 12 do not apply the package field. An empty `pnpm.overrides` is never treated as "no overrides" without reading the workspace.

**Options:**

- `--save` — write the current merged overrides to `.overrides-snapshot.json` (gitignored); later runs compare against it and exit non-zero on any add, removal, or change.

### `josh latest`

Update all dependencies to latest, run a security audit, then update pnpm with its self-update command. The pnpm bump runs last, right before the run is recorded, so a failed bump still lets the dependency update and the audit finish but leaves the run unrecorded and exits non-zero.

```bash
pnpm josh latest            # full update (update + audit + pnpm)
pnpm josh latest:corepack   # update pnpm only
pnpm josh latest:update     # update dependencies only
```

`josh latest` never lowers a version: a supply-chain age gate can make the registry report an older release as newest, so `latest:update` rolls the whole tree back rather than writing a silent downgrade. It reports the overrides verdict itself and separately fails the run if `pnpm-lock.yaml` no longer honours an unconditional override. Whether a run has to update at all is [`josh latest:scope`](josh-commands-automation.md#josh-latestscope).

#### `josh latest:corepack`

Updates pnpm and pins `packageManager` to the newest release on the project's **current major** (from `packageManager`, or from `devEngines.packageManager.version` when that is the only pin). The command name is retained for compatibility. With an existing `packageManager` pin, it obtains the release integrity value, runs `pnpm self-update`, then restores the integrity suffix and aligns `devEngines.packageManager.version` byte-for-byte with `packageManager`. Without that pin, it adds a verified pin and checks that the selected pnpm version starts. A registry answer that is not newer than the pin, or no release on the major aged past the quarantine window yet, is a skip and exits `0`. Any failure — a registry that does not answer, no integrity value, `pnpm self-update` exiting non-zero, an unexpected pin after it, or a selected version that cannot start — restores `package.json`, prints the cause and exits `1`. When pnpm runs through the Corepack shim, which pnpm 11 and later refuse to self-update under (`ERR_PNPM_CANT_SELF_UPDATE_IN_COREPACK`), the message also names the remedy: `corepack disable pnpm`, a standalone pnpm, and `josh sync` so `devEngines.packageManager.onFail` is `"download"` — the standalone pnpm then fetches the pinned version rather than refusing to run. Either way, existing `devEngines` drift is still aligned to `packageManager`.

#### `josh latest:update`

Runs `pnpm update --latest`, skipping **held-back** and **overridden** packages (effective overrides read from `pnpm-workspace.yaml`) — `typescript` is currently held at `6.x`. Skipped packages print as `⏭ Skipping held-back / overridden packages: …`. If any direct dependency would move down, it restores `package.json` and `pnpm-lock.yaml` to what it found and exits `0`. Otherwise it also moves the `SAFE_CHAIN_INSTALLER_VERSION` / `SAFE_CHAIN_INSTALLER_SHA256` env to the newest `@aikidosec/safe-chain` release — a registry answer that is not an exact semver version is refused and nothing moves — in every workflow under `.github/workflows` and `templates/workflows` and every local composite action under `.github/actions` that carries the pin — in kit itself, the `.github/actions/setup-pnpm` action every workflow installs through, the distributed `ci.yml` included — the hash is computed from that release's `install-safe-chain.sh`, and a failed download leaves the workflows' pins untouched (the next `josh latest` retries).

## AI tools

Helpers for AI-assisted development workflows.

### `josh backlogrun`

Start a `backlogrun` from the terminal and watch it on [`josh run:board`](./josh-commands-run.md#josh-runboard). The agent runs in the background in the main checkout, its output going to a log file, and the board takes over the terminal at once.

```bash
pnpm josh backlogrun                    # start in Claude, then show the board
pnpm josh backlogrun 3437 --only        # the arguments go to backlogrun as typed
pnpm josh backlogrun --agent codex      # start in Codex
```

- The arguments are the `backlogrun` keyword's own: named Issues, `--only`, `--max <n>`, `--idle <minutes>`. A bare number in the named list is read as `#<n>`, since an unquoted `#` starts a shell comment.
- `--agent claude|codex` picks the agent; the default is `claude`. The start command is built by `scripts/agent/agent-argv.ts`, the same builder that starts lane children, and the choice is handed to the run as `JOSH_AGENT_PROVIDER`.
- A run already going in this repository is never joined by a second one: nothing is started, the board is shown, and each named Issue is printed as a `run:add` line to add it by hand.
- Closing the board (Ctrl+C) closes only the board; the run goes on, and the board's last line says so. When the run stops for a person, the board prints the `claude --resume <session-id>` that reopens it.

**Output / exit codes:** prints one line naming the started pid, session and log path, then the board's exit code. Bad arguments print the usage and exit 1; an agent that cannot start (a missing or outdated CLI) exits 1 without a board.

### `josh lane:limit`

Change a running `backlogrun`'s lane limit without stopping it. The run keeps the environment it started with, so `JOSH_LANE_LIMIT` cannot change under it; this writes an override onto the run's record, which every lane-limit read takes over the environment.

```bash
pnpm josh lane:limit 8        # raise or lower the live run's limit to 8
pnpm josh lane:limit          # print the limit, the lanes in use and the free lanes
pnpm josh lane:limit --reset  # clear the override; JOSH_LANE_LIMIT applies again
```

- The next lane allocation uses the new limit. Raising it writes a `lane-limit` event, and the parent's `run:progress --wait` watcher wakes the parent within a minute to fill the freed lanes.
- Lowering it stops no running child: a lane that finishes is simply not refilled.
- A limit above the nine port seats is shown and counted at the seats, as `JOSH_LANE_LIMIT` already is. A value that is not a positive integer is refused by the same rule.
- The override lives and ends with the run (`run:carry --end` removes it). With no run in progress, the command refuses and points at `JOSH_LANE_LIMIT`.

**Output / exit codes:** prints `lane limit <n> (<source>) · in use <n> · free <n>` and exits 0. Bad arguments, an invalid limit or no run in progress exit 1.

### `josh rule:value`

Print each delivered rule's **unaided compliance** — how far the carried text alone kept the rule in the window before its trigger fired (`scripts/rules/rule-value.ts`). One row per rule: the runs that reached the situation it governs, the rate kept before the trigger (or `unmeasured` where the rule declares no `keeps` predicate, `unreached` where no run reached it), and the refusals the hook actually delivered — followed by `rewritten N` on a rule whose hook rewrote the call instead of refusing it.

```bash
pnpm josh rule:value
pnpm josh rule:value --refresh   # write the reading to the loop-head cache instead of stdout
```

- Transcripts are grouped by the run they belong to, so a lane's transcript counts with the parent that dispatched it rather than as a run of its own.
- It reports and never fails: an environment with no measurable transcript prints `no measurement targets` and exits zero.
- Read once per iteration at the `backlogrun` loop head (`josh backlog:offer`), so a rule that never fires appears as a printed row rather than as something a person has to think to measure. The loop head never measures: it prints the last reading from `node_modules/.cache/josh/rule-value.txt` to stderr and, at most once every 15 minutes, starts a detached `josh rule:value --refresh` that rewrites it, so the offer never waits on the measurement and a failed one never changes its answer. Single sources: `scripts/rules/rule-value-cli.ts` and `scripts/rules/rule-value-cache.ts`.
