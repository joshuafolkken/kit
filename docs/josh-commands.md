# josh CLI — Command Reference

The commands you type by hand — the `developer` audience. Look a command up here rather than reading top to bottom. Commands that need Node tooling (ESLint, `tsc`, Vitest, Playwright) skip in a `basic` project and say why.

See also:

- [Automation command reference](josh-commands-automation.md) — the commands hooks, workflow runs, lanes and maintainers call.
- [Issue, epic, backlog and review command reference](josh-commands-backlog.md) — the commands a workflow run calls to file issues, track epics, plan a backlog and brief a review.
- [Command Catalog](josh-command-catalog.md) — auto-generated index of every command (name, aliases, synopsis, audience, side effects).

`josh` is available as `pnpm josh` (or `pnpm exec josh`) after running `josh init`. Run `pnpm josh help` to print a grouped summary in the terminal, and `pnpm josh help <command>` for one command's usage. How the dispatcher runs a command in kit's own checkout, and the shape a new script keeps: `docs/maintainers/josh-commands-rationale.md` → "How a command runs".

A `<!-- usage: … -->` span is generated from `scripts/josh/josh-usage-developer.ts` by `tsx scripts/document/generate-command-usage.ts` — edit the table, not the span.

## Development

These commands replace the corresponding `package.json` scripts; consumer projects need not add them manually.

### `josh gate`

Run the completion gate's checks — lint, type check, spell check, [behavior](#josh-behavior), [unused namespace members](#josh-exportsunused), the [metrics ratchet](#josh-metrics) (kit only) and unit tests — **concurrently**, running all to completion and reporting every failure in one pass.

<!-- usage: gate -->

```bash
pnpm josh gate
pnpm josh gate --verbose   # every check's output, passing ones included
pnpm josh gate --force     # re-run even on a tree already recorded green
pnpm josh gate --no-unit   # the static checks only (CI only)
```

<!-- /usage -->

- Static checks: `pnpm josh lint`, `pnpm josh cspell:dot`, `pnpm josh behavior`, `pnpm josh exports:unused`, `pnpm josh metrics` (in kit only); the unit leg is `pnpm josh test:related`; the type check resolves to a toolkit `check:ci` / `check` when installed, else `pnpm josh check`.
- A tree recorded green is reused unless `--force` or the changed-file map moved.
- Otherwise `lint`, `check` and `exports` are each reused while none of their inputs moved since they last passed silently (`scripts/gate/check-inputs.ts`); the header reads `reused — inputs unchanged since it passed at <time>`.
- The other checks always run; `--force` and `--no-unit` reuse nothing.
- **Refuses to start when the scoped pair has not been green on this tree.** A unit-included local gate reads the same record `josh review:brief` does and refuses — naming `pnpm josh lint:related && pnpm josh test:related` — so the first gate is the only gate. It never fires for `--no-unit` (CI has no scoped check in front of it) or `--force`, and `JOSH_SCOPED_GREEN=0` turns it off.
- **On failure, a line per failed check with the command to re-run is printed at the tail**, just above the verdict, so a `tail` of the output keeps every failure and its next action rather than one at a time.
- **The last line is the verdict, counting what ran apart from what was skipped**: `✔ verification gate passed (6 checks) in 41.2s.`, or `⚠ verification gate not verified (0 ran, 6 skipped) in 0.2s.` — which exits `0` but writes no green record.
- Exit `1` if any check failed. Refuses any argument other than the three flags.
- The unit leg is the long pole; [`josh test:related`](#josh-testrelated) narrows it to the tests the change can reach and runs the whole suite when it cannot tell. CI runs the whole sharded suite regardless.
- **Each check waits for a place in a machine-wide core budget** (`scripts/gate/core-budget.ts`), so overlapping gates share the machine. How it is weighted: `docs/maintainers/josh-commands-rationale.md` → "`josh gate`'s core budget".

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh gate` in detail".

### `josh lint`

Check code with prettier and eslint.

<!-- usage: lint -->

```bash
pnpm josh lint
```

<!-- /usage -->

### `josh lint:related`

Check only the files the change touched — the lint check an implementation loop repeats between edits. Added in front of the whole-tree `josh lint`, never in place of it.

<!-- usage: lint:related -->

```bash
pnpm josh lint:related
pnpm josh lint:related scripts/thing.ts   # narrow by the given files instead
```

<!-- /usage -->

- Changed set = branch diff plus untracked files (cache `.eslintcache.related`); flags are named rather than forwarded (`--fix` is reported ignored).
- Falls back to the whole tree (naming which case) when no changed file is lintable.
- Also runs the fast byte-ceiling check on any changed agent-read document, sharing `document-byte-budget.ts`: a mandated documentation update over its ceiling fails here in seconds rather than at the 80–90-second gate, and the green record is withheld until both lint and the byte check pass.

### `josh lines`

Print how many code lines a file has against the `max-lines` limit and how many remain — so splitting is decided before writing.

<!-- usage: lines -->

```bash
pnpm josh lines scripts/hooks/format-edited-file.ts scripts/josh/josh-logic.ts
```

<!-- /usage -->

```
limit 300 code lines · near from 255
scripts/hooks/format-edited-file.ts  230/300 code lines (76%), 70 to spare
```

- Count is lint's own (`skipBlankLines` / `skipComments`); `near from` marks 85%. Never fails on a large file — a non-zero exit means the argument list was unusable.

### `josh bytes`

Print how many bytes an agent-read document has against its recorded byte ceiling and how many remain — the byte counterpart of `josh lines`, so a mandated documentation update that would cross the ceiling is seen right after the edit rather than at the gate.

<!-- usage: bytes -->

```bash
pnpm josh bytes docs/josh-commands.md   # one document
pnpm josh bytes                         # scan: every budgeted document near its ceiling
```

<!-- /usage -->

```
docs/josh-commands.md  34492/36864 bytes · 2372 left
entry fullrun  227672/229376 bytes · 1704 left
```

- The scan closes with one row per workflow entry — the **primary** budget (`entry-read-budget.ts`), the total each entry reads against its ceiling — so the main budget is no longer a number the gate reveals only when it fails. The per-document rows above them are the fallback budget, covering the documents no entry reads.
- Path is repository-root-relative (a leading `./` is stripped); a path with no budget entry reads `not counted`.
- The recorded ceiling is the next 4 KB block at or above the document's size (`document-byte-budget.ts`). Never fails — the gate enforces the ceiling.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh bytes` in detail".

### `josh metrics`

Print the repository-wide quality totals no per-function or per-file limit sees — code lines, comment lines and the comment ratio for the non-test files under `scripts/`, the lines of the rule documents (`CLAUDE.md` and `prompts/**/*.md`), the number of `*:guard` commands, and the AI cost in bytes (resident, on demand) — and hold them to the same totals measured on the merge-base.

<!-- usage: metrics -->

```bash
pnpm josh metrics                             # print the totals and check them against the merge-base's
pnpm josh metrics --accept --reason "<why>"   # record this branch's growth and why
```

<!-- /usage -->

- **A ratchet, and a step of [`josh gate`](#josh-gate)**: exits `1` when a total grew past the merge-base's; the only way up is `--accept --reason "<why>"`. History: `docs/maintainers/josh-commands-rationale.md` → "`josh metrics`' totals".
- **kit only**: it counts kit's own rule documents and guards, so a consumer's gate leaves the step out.
- The prose density is held too, over `README.md`, `docs/`, `prompts/` and `.claude/skills/`. It counts paragraphs over 400 characters, and bold spans beyond the first in each section.
- Code lines are lint's own `max-lines` count (one lower than `josh lines` on a `#!` file); a comment line is any other non-blank line.
- **Durations** fail past +10% of this machine's baseline; a gate times no startup — `docs/maintainers/josh-commands-rationale.md` → "`josh metrics`' durations".

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh metrics` in detail".

### `josh format`

Format code with prettier and eslint. A `basic` project without Prettier or ESLint skips that tool for the reason `josh lint` prints.

<!-- usage: format -->

```bash
pnpm josh format
```

<!-- /usage -->

### `josh cspell:dot`

Run spell check, including dotfiles.

<!-- usage: cspell:dot -->

```bash
pnpm josh cspell:dot   # includes dotfiles
```

<!-- /usage -->

- Runs with `--no-progress`, so it prints only the unknown-word lines and the summary — not the per-file `N/1607 <path> cached` progress that once filled the whole output past the tool's truncation cap.

### `josh behavior`

Check the current run's recorded transcript against the behavior assertions and report where any broke — with **no live Claude session and no model call**. It is one of `pnpm josh gate`'s checks, so behavior regressions are caught every run rather than only by eye.

<!-- usage: behavior -->

```bash
pnpm josh behavior
```

<!-- /usage -->

- **The data is what every run already writes.** Claude Code files each session's transcript under `~/.claude/projects/**/*.jsonl`; an assertion read off a recorded transcript is deterministic, re-runnable and never calls a model — which is exactly what joshuafolkken/kit#1922 removed the slow five-live-session `josh eval` path for lacking.
- **The scope is the current run** — the newest session transcript — not the whole corpus.
- **A run with no transcript passes** without the skip marker, so a CI runner — which has none — never withholds the gate's green record.
- **The assertions**, each verified green against past real runs before it joined; a Bash call refused before it ran breaks none of them:
  - `no-direct-git-index-mutation` — `git add` / `git commit` / `git rm --cached` / `git restore --staged` must go through `pnpm josh git` (dry runs excluded).
  - `no-direct-pr-create` — a pull request must be opened with `pnpm josh pr`, never `gh pr create` / `gh pr new` or a `gh api` POST to the pulls path; the matcher is the `direct-pr-create` guard's own.
- New assertions are added one at a time. A break prints which run and which point it broke at.
- **The manual `josh eval` is untouched**: this restores behavior verification without reviving the live-session path it removed.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh behavior` in detail".

### `josh exports:unused`

Report every member of an exported namespace object that nothing in the program reads. It is one of `pnpm josh gate`'s checks, so a dead namespace member fails the gate rather than accumulating.

<!-- usage: exports:unused -->

```bash
pnpm josh exports:unused
```

<!-- /usage -->

- **Why its own check**: the namespace convention (`const git_prompt = { confirm_push }` exported as `export { git_prompt }`) keeps the namespace itself imported everywhere, so an ordinary unused-export tool never sees a member nobody calls.
- **Scanned**: `snake_case`, un-annotated object-literal constants exported through a bare `export { x }` in a `.ts` file of the `tsconfig.json` program. An `UPPER_CASE` constant, a type-annotated table, a public `index.ts` entry and a test file declare no namespace it checks.
- **A use is any reference the checker resolves to the member** — a property access, a destructuring, a string-keyed access, or `vi.spyOn(namespace, 'member')` — from any file, tests included.
- **A namespace that escapes whole counts as fully used**: spread, passed as a value, read through a computed key, or re-exported. An alias or a member of another namespace stays tracked.
- Exit `1` with one `path:line  namespace.member` line per finding. Remove the member from its namespace object, and its declaration if nothing in its file uses it either.
- **kit only**: a consumer project reads its namespaces from `.svelte` files and routes this program does not see, so it skips with a notice.

### `josh test:unit`

Run vitest unit tests. Without `vitest`: **skips (exit 0)**; a `basic` project runs its [`test` script](./setup/basic.md#3-verify). With `vitest` and a test file: `vitest run`.

<!-- usage: test:unit -->

```bash
pnpm josh test:unit
```

<!-- /usage -->

- `vitest` with **no** `*.{test,spec}.{ts,js}` file fails; `basic` projects skip.
- Guards (kit's own checkout): a unit test that reaches the network or writes into the suite's repository fails; the fix is in the test (mock the read, clear git location env, carry identity on `-c`).
- **The suite runs as two Vitest projects** (`vitest.config.ts`): `pure` with `isolate:false` and `isolated` — the same files and green condition, the pure ones faster.
- **A setup file silences the real streams for each test body** (`scripts/test/test-stdout-guard.ts`), so a fixture that drives a CLI `main` cannot leak its `process.stdout` lines into the suite's output; `console.*` is untouched and the streams are restored after each test.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh test:unit` in detail".

### `josh test:related`

Run only the unit tests related to the files the change touched — the unit check an implementation loop repeats between edits. `josh gate` runs it as its unit leg.

<!-- usage: test:related -->

```bash
pnpm josh test:related
pnpm josh test:related scripts/thing.ts   # narrow by the given files instead
pnpm josh test:related --silent           # flags are forwarded to vitest
```

<!-- /usage -->

- Changed set handed to `vitest related`; value-taking flags must be `--flag=value`. Falls back to the whole suite (naming which case) when a changed non-code file has no map or no recorded reader and is new since the map's tree, or a changed file is one every test depends on; a narrowed run matching nothing prints `No test files found` and exits 0.
- A changed non-code file narrows to the tests that read it, per the test-read map a whole-suite `josh test:unit` records (`<git-common-dir>/josh/test-read-map.json`); with no map the changed set is the branch diff.
- A change made only of non-code files the map's tree held and no test read runs no test: it says why and exits 0 without starting vitest.

### `josh test:declared`

Report whether the working-tree change needs a test — `required`, `exempt` or `satisfied` — from changed paths alone; `pnpm josh git -y` refuses on `required`. Verify a declaration with `pnpm josh test:declared --match < summary.md`.

<!-- usage: test:declared -->

```bash
pnpm josh test:declared
pnpm josh test:declared --match   # check Step 0 declarations on stdin
pnpm josh test:declared --help    # print usage, including the --match stdin form
```

<!-- /usage -->

An unknown flag is refused with the usage rather than ignored, the same convention `josh time` follows.

`--match` checks each `Test: <type> — <path>` declaration on stdin against the change set, printing `match` / `type-mismatch` / `path-missing` / `test-not-created` per line; any mismatch exits non-zero.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh test:declared` in detail".

### `josh test:red`

Run the changed `*.test.ts` files on a temporary merge-base worktree and print `red`, `green`, `no-test` or `test-only`. On an Issue declaring `- 種別: 不具合`, `pnpm josh git -y` refuses `green`.

<!-- usage: test:red -->

```bash
pnpm josh test:red   # red, green, no-test or test-only
```

<!-- /usage -->

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh test:red` in detail".

### `josh test:e2e`

Run E2E tests with Playwright. **Skips gracefully (exit 0)** when `@playwright/test` is not installed or no `*.e2e.{ts,js}` files exist. Once both are present, runs `playwright test`.

<!-- usage: test:e2e -->

```bash
pnpm josh test:e2e
```

<!-- /usage -->

### `josh test`

Run unit tests followed by E2E tests.

<!-- usage: test -->

```bash
pnpm josh test
```

<!-- /usage -->

`josh test` is a **composite command** and takes no extra arguments — pass runner flags to the stage that understands them:

```bash
pnpm josh test:e2e --workers=1   # ✅ reaches Playwright
pnpm josh test:unit -u           # ✅ reaches Vitest
pnpm josh test --workers=1       # ❌ exits 1, naming test:unit and test:e2e
```

See [Composite commands and extra arguments](#composite-commands-and-extra-arguments).

### `josh check`

Type-check with `tsc --noEmit`. A `basic` project with nothing to check is skipped as `josh gate` does; a listed, uninstalled tool fails. SvelteKit type-checking is not part of kit's framework-agnostic `josh` CLI: SvelteKit projects get `josh-app check` / `josh-app check:ci` from [`@joshuafolkken/app-kit`](https://github.com/joshuafolkken/app-kit).

<!-- usage: check -->

```bash
pnpm josh check
```

<!-- /usage -->

### `josh port`

Print the port this project's dev or preview server runs on, resolved from `PORT_SEED`.

<!-- usage: port -->

```bash
pnpm josh port dev       # 5173 with no seed set
pnpm josh port preview   # 4173 with no seed set
```

<!-- /usage -->

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

<!-- usage: profile -->

```bash
pnpm josh profile
```

<!-- /usage -->

### `josh start`

Set a new or existing project up for the GitHub Issue workflow, so `kickoff new` works once the setup is on `main`. Use `josh init` for a project without the workflow or for a re-run — [init.md → `josh init` or `josh start`](./init.md#josh-init-or-josh-start) compares the two and lists the steps per starting state.

<!-- usage: start -->

```bash
pnpm josh start                                  # asks for the profile and the repository
pnpm josh start --yes --github --profile basic   # unattended, including the GitHub repository
```

**Options:**

- `--profile basic|full` — the profile, without asking.
- `--yes` — take the defaults — not consent to write to GitHub.
- `--github` — create the GitHub repository and push `main`.
- `--public` — create the repository public instead of private.
- `--init-command "<command>"` — run this setup command in place of `josh init`.
- `--push-preflight-command "<command>"` — a check run before the first step when the plan pushes; a failure stops the run before it writes anything.
- `--dry-run` — print the plan and change nothing.

<!-- /usage -->

**Prerequisites:** the [gh CLI](https://cli.github.com/), signed in, and a Git author identity for a run that commits ([Tell Git who you are](./setup/prerequisites.md#4-tell-git-who-you-are)); without either it stops before changing anything.

The `full` profile's pre-push hook runs `josh audit`, which needs `osv-scanner`. A run that pushes fetches the pinned scanner itself before its first step (the same fetch as `pnpm josh audit:provision --force`), so nothing has to be installed by hand; where the fetch fails and no scanner is on `PATH`, `josh start` stops before changing anything and prints the cause.

**Steps**, printed as `[n/N]` while they run:

1. `git init` on `main` — skipped when Git already exists
2. The same setup `josh init` runs, with the confirmed profile
3. The initial commit of every file — only without commits
4. `gh repo create <directory name> --private` (or `--public`) and push `main` — only without an origin
5. The missing workflow and release-classification labels; existing ones are left unchanged
6. The setup pull request — only while `main` has commits but no kit: an Issue, a commit of only kit's files on its branch, and the pull request. It never merges

What `--dry-run` prints: [init.md → Preview with `--dry-run`](./init.md#preview-with---dry-run).

**Existing state:** an existing GitHub origin is never replaced and `main` is never pushed to; a re-run after a failed commit hook resumes step 6. A non-GitHub origin, commits on a branch other than `main`, or — once the repository has a commit — a dirty working tree is refused before any change; the setup branch a failed commit left is exempt.

**Output / exit codes:** exits 0 when every step has run. A failed step exits 1 and prints the step it stopped at, the completed steps and the cause.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh start` in detail".

### `josh init`

Initialize project config, selecting a profile and reporting applicable repository settings.

<!-- usage: init -->

```bash
pnpm josh init   # create/merge config files, install and format (--no-install skips both, --dry-run only prints the plan)
```

<!-- /usage -->

**Output / exit codes:** exits non-zero inside the distribution package's own repository, where it writes nothing, and when its `pnpm install` fails.

See [init.md](./init.md) for the full file list and [`josh doctor`](#josh-doctor) for the settings reports.

### `josh registry:migrate`

Migrate an existing project from GitHub Packages to public npm: check that every locked `@joshuafolkken` package is on public npm, then update `.npmrc` and the lockfile, restoring both if resolution fails.

<!-- usage: registry:migrate -->

```bash
pnpm josh registry:migrate
```

<!-- /usage -->

**Output / exit codes:** exits non-zero without changing settings when a locked scoped package version is unavailable on public npm, configuration is ambiguous, or the resolved lockfile still points to GitHub Packages. Re-running a completed migration is a no-op. See [authentication.md](./authentication.md) for the setup being replaced.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh registry:migrate` in detail".

### `josh sync`

Overwrite managed files with the latest versions from the package. Run after upgrading `@joshuafolkken/kit` to pull in updated AI files, workflow templates, and other managed files. Also realigns `devEngines.packageManager.version` with the `packageManager` pin, and creates missing labels as [`josh start`](#josh-start) does.

<!-- usage: sync -->

```bash
pnpm josh sync   # overwrite managed files
```

<!-- /usage -->

**Output / exit codes:** exits non-zero inside the distribution package's own repository, where syncing would overwrite the source with its own derived templates.

See [sync.md](./sync.md) for the full file list.

### `josh uninstall`

Remove what kit added to a project. It prints three lists before it changes anything — what it removes, what it keeps, and what is left for you to review — and removes only the first.

<!-- usage: uninstall -->

```bash
pnpm josh uninstall         # show the plan, then ask
pnpm josh uninstall --yes   # remove without asking
```

<!-- /usage -->

- **Remove:** each distributed file that is still byte for byte what kit writes, the `@joshuafolkken/kit` dependency and the `josh.profile` record in `package.json`, and the git hooks lefthook installed (`lefthook uninstall`, where `lefthook.yml` is one kit wrote or merged into). A directory the last removed file leaves empty goes with it.
- **Keep:** a distributed file that differs from what kit writes — one you edited, or one of your own that kit merged entries into.
- **Review by hand:** the `package.json` entries kit merges in (`scripts.josh`, `devDependencies.prettier`, …) that the project still holds, `sonar-project.properties` / `.aikido` when present, and `.gitignore` — deleting it would un-ignore `.env` and `node_modules`. They are never changed: `josh init` kept no record of the values it found.

**Options:** `--yes` skips the question. `--profile basic|full` names the profile whose files are compared, instead of the recorded one. Without a terminal and without `--yes`, the run is a preview that removes nothing.

**Output / exit codes:** exits non-zero inside the distribution package's own repository, where it removes nothing. Files are compared with the installed kit version, and nothing in `node_modules`, `pnpm-lock.yaml` or on GitHub is touched — see [Remove kit from a project](./how-to/uninstall.md).

### `josh adopt`

Upgrade every `@joshuafolkken/*` toolkit in **this** repository to latest, sync its managed files, run [`josh latest`](#josh-latest), verify, and open the issue and pull request — the consumer-side counterpart of [`josh propagate`](josh-commands-automation.md#josh-propagate).

<!-- usage: adopt -->

```bash
pnpm josh adopt
pnpm josh adopt --dry-run   # report the steps without touching anything
```

**Options:**

- `--dry-run` — report the plan without writing.

<!-- /usage -->

Steps: working-tree check, `pnpm add -D <toolkit>@latest` per toolkit, `pnpm josh sync`, `pnpm install`, `pnpm josh latest`, [`josh gate`](#josh-gate), open issue, `pnpm josh git`, return to the default branch.

**Output / exit codes:** exits `0` on a skip; a failing step exits non-zero, and one before `pnpm josh git` opens no pull request. Stops at the open pull request — merging is [`josh followup`](josh-commands-automation.md#josh-followup)'s job.

---

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh adopt` in detail".

## Workflow

AI-assisted git and notification helpers used in the day-to-day development loop.

### `josh git`

Interactive AI-assisted git commit workflow: stages changes, generates a commit message, opens the pull request, and optionally pushes. When no issue argument is given, the issue number and title are derived from the current branch name (`<N>-<slug>`).

<!-- usage: git -->

```bash
pnpm josh git                                # interactive
pnpm josh git -y                             # unattended (no TTY required)
pnpm josh git -y "title"                     # set commit message prefix
pnpm josh git -y "<title> #<N>"              # follow-up commit on the same branch
pnpm josh git -y --skip-commit --skip-push   # open the PR without committing/pushing
```

**Options:**

- `-y` / `--yes` — run non-interactively; works without a TTY (agent or CI shell).
- `--skip-commit` / `--skip-push` — recover/open a PR without a new commit or push.

<!-- /usage -->

**Behavior:** returns as soon as the PR is open and prints its URL — it does not wait for checks (`josh followup` does). Re-running on the same branch makes a follow-up commit and reuses the open PR. Each push is bounded at 120 s and retried once on timeout, the failure naming the command to re-run by hand.

Related: [`josh followup`](josh-commands-automation.md#josh-followup), [`josh pr`](#josh-pr).

### `josh pr`

Create the pull request for the current issue branch — a recovery/standalone counterpart to `josh git` for when the branch is already committed and pushed. It derives the issue number and title from the branch name (`<N>-<slug>`) and generates the `closes #N` line.

<!-- usage: pr -->

```bash
pnpm josh pr   # open the PR for the current <N>-<slug> branch
```

<!-- /usage -->

**Behavior:** reports an existing open PR for the branch instead of opening a second one.

### `josh review:findings`

Count the recorded review findings by category — the reader over what `josh review:record` wrote. It reads the observation ledger, tallies each recurring category most-frequent-first, and prints the number of zero-finding rounds, which tells a genuinely quiet category apart from one nobody looked at.

<!-- usage: review:findings -->

```bash
pnpm josh review:findings
```

<!-- /usage -->

**Behavior:** counts only `- rf:` lines, ignoring the `- k:` observation lines in the same file. The `none` sentinel lines are excluded from the category tally and reported as the zero-finding round count instead. A ledger with no finding lines prints `no review findings recorded yet`.

Related: [`josh review:record`](josh-commands-automation.md#josh-reviewrecord).

### `josh main:sync`

Checkout the default branch and pull the latest changes with `git pull --ff-only` (the strategy is named by the command, not read from git config).

<!-- usage: main:sync -->

```bash
pnpm josh main:sync
```

<!-- /usage -->

**Behavior:** refused inside a lane. Pulls with `--ff-only` — the opposite of [`josh main:merge`](#josh-mainmerge) — then prunes local branches whose upstream is gone, that are merged, and that no work tree has checked out.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh main:sync` in detail".

### `josh main:merge`

Bring the repository's default branch into the branch this checkout is on: fetches `origin/<default>` and merges it into the current branch.

<!-- usage: main:merge -->

```bash
pnpm josh main:merge
```

<!-- /usage -->

**Behavior:** merges with an explicit strategy rather than rebasing, so a diverged branch merges cleanly without a force push. A conflict only on generated files (`scripts/git/main-merge-regenerate.ts`) is regenerated and committed; any other conflict, or uncommitted work on an incoming path, fails.

---

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh main:merge` in detail".

## Versioning

### `josh version`

Show the global-install, project and latest published versions, plus the **running binary**. A stale install gets a `Run:` hint; a shadowing `josh` on `PATH` points to [`josh doctor --fix`](#josh-doctor).

<!-- usage: version -->

```bash
pnpm josh version
pnpm josh version --upgrade   # upgrade global + project to latest, then re-run fix-gh-packages
```

**Options:**

- `--upgrade` — upgrade both the global install (`pnpm add -g`) and the project devDependency (`pnpm add -D` + `fix-gh-packages`); already-current or not-installed targets are skipped.

<!-- /usage -->

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh version` in detail".

### `josh ranges`

Check that every dependency range this package **publishes** still resolves for a consumer, probing `pnpm view <name>@<range> version` under safe-chain's shims.

In a package built on a `@joshuafolkken/*` toolkit it also fails when a published `peerDependencies` floor sits below the toolkit's.

<!-- usage: ranges -->

```bash
pnpm josh ranges
```

<!-- /usage -->

**Output / exit codes:** fails closed — a probe that cannot answer is unresolvable. Probing `@joshuafolkken/*` needs `NODE_AUTH_TOKEN` (`export NODE_AUTH_TOKEN=$(gh auth token)`).

---

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh ranges` in detail".

## Maintenance

### `josh doctor`

Diagnose — and optionally repair — PATH shadowing of the global `josh`.

<!-- usage: doctor -->

```bash
pnpm josh doctor           # diagnose only
pnpm josh doctor --fix     # reclaim the global josh by removing a stale kit shim
pnpm josh doctor --ports   # also print the per-repository port-seed table
```

**Options:**

- `--fix` — remove a shadowing binary **only if it is a kit shim** (its body references `@joshuafolkken/kit` or the removed `install-bin` script); any other binary is left and reported for manual review. Also the one-shot recovery for an old project that re-created the global shim.
- `--ports` — additionally print the port-seed table (see below).

<!-- /usage -->

`doctor` reports the running binary, the `josh` first on `PATH` and the pnpm-global install; in a kit consumer it adds a **Consumer setup** section and repository settings, including the [`josh ruleset:check`](josh-commands-automation.md#josh-rulesetcheck) report. None of these fails the command or changes a setting.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh doctor` in detail".

#### The discovered repository map

`doctor` prints the **repository map** — every checkout on this machine that belongs to the same GitHub owner as the current repository, with its local path — so other commands can locate a sibling before writing into it.

```text
Repositories (same owner, discovered next to this one):
  joshuafolkken/app-kit   /Users/example/Development/app-kit
  joshuafolkken/kit       /Users/example/Development/kit
```

Discovery is automatic: `doctor` scans the parent directory one level deep and keys each work tree by its `origin` remote's `owner/repo`. **The directory name is never used as the repository name**.

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

Detail: `docs/maintainers/josh-commands-rationale.md` → "The discovered repository map in detail".

### `josh audit`

Run a security audit against the lockfile.

<!-- usage: audit -->

```bash
pnpm josh audit
```

<!-- /usage -->

The scanner is looked up on `PATH` first, then in the `josh audit:provision` cache (`node_modules/.cache/josh-tools/`). With neither present the audit exits non-zero and prints how to get one — it is never skipped or weakened.

### `josh overrides`

Check that the dependency overrides have not drifted after a dependency update.

<!-- usage: overrides -->

```bash
pnpm josh overrides          # verify overrides unchanged
pnpm josh overrides --save   # snapshot current merged overrides
```

**Options:**

- `--save` — write the current merged overrides to `.overrides-snapshot.json` (gitignored); later runs compare against it and exit non-zero on any add, removal, or change.

<!-- /usage -->

Checks effective overrides from `pnpm-workspace.yaml` against a saved snapshot and reports ignored `pnpm.overrides` entries in `package.json` separately. pnpm 11 and 12 do not apply the package field. An empty `pnpm.overrides` is never treated as "no overrides" without reading the workspace.

### `josh latest`

Update all dependencies to latest, run a security audit, then update pnpm with its self-update command. The pnpm bump runs last, right before the run is recorded, so a failed bump still lets the dependency update and the audit finish but leaves the run unrecorded and exits non-zero.

<!-- usage: latest -->

```bash
pnpm josh latest   # full update (update + audit + pnpm)
```

<!-- /usage -->

`josh latest` never lowers a version — a would-be downgrade rolls the whole tree back — and fails when `pnpm-lock.yaml` no longer honours an unconditional override. Whether to update at all is [`josh latest:scope`](josh-commands-automation.md#josh-latestscope).

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh latest` in detail".

#### `josh latest:corepack`

Updates pnpm and pins `packageManager` to the newest release on the project's current major with `pnpm self-update`, keeping `devEngines.packageManager.version` aligned. A failure restores `package.json` and exits `1`.

<!-- usage: latest:corepack -->

```bash
pnpm josh latest:corepack   # update pnpm only
```

<!-- /usage -->

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh latest:corepack` in detail".

#### `josh latest:update`

Runs `pnpm update --latest`, skipping held-back and overridden packages; a would-be downgrade restores `package.json` and the lockfile. It also moves the safe-chain installer pin in every workflow and composite action that carries it.

<!-- usage: latest:update -->

```bash
pnpm josh latest:update   # update dependencies only
```

<!-- /usage -->

When the update moved `@playwright/test`, it installs the browsers (`JOSH_PLAYWRIGHT_BROWSERS` widens the list); a failed install stops `josh latest`.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh latest:update` in detail".

## AI tools

Helpers for AI-assisted development workflows.

### `josh backlogrun`

Start a `backlogrun` from the terminal and watch it on [`josh run:board`](./josh-commands-run.md#josh-runboard). The agent runs in the background in the main checkout, its output going to a log file, and the board takes over the terminal at once.

<!-- usage: backlogrun -->

```bash
pnpm josh backlogrun                 # start in Claude, then show the board
pnpm josh backlogrun 3437 --only     # the arguments go to backlogrun as typed
pnpm josh backlogrun --agent codex   # start in Codex
pnpm josh backlogrun --stop          # stop the run in this repository
```

<!-- /usage -->

- The arguments are the `backlogrun` keyword's own: named Issues, `--only`, `--max <n>`, `--idle <minutes>`. A bare number in the named list is read as `#<n>`, since an unquoted `#` starts a shell comment.
- `--agent claude|codex` picks the agent; the default is `claude`. The start command is built by `scripts/agent/agent-argv.ts`, the same builder that starts lane children, and the choice is handed to the run as `JOSH_AGENT_PROVIDER`.
- A run already going in this repository is never joined by a second one: nothing is started, the board is shown, and each named Issue is printed as a `run:add` line to add it by hand.
- An idle run is replaced by a different invocation, so `--stop` need not be typed first. The run going is stopped as `--stop` stops it and the typed one is started when all of these hold:
  - the typed invocation differs from the one the run was started with — the same invocation, a bare `pnpm josh backlogrun` over a bare one included, only shows the board, so reopening the board never rebuilds a run;
  - the run is watching: its backlog drained, it has launched no child since, and it owes no end-of-run retrospective (`JOSH_RETROSPECTIVE`);
  - no child is working in a lane — a lane left open with no child in it (a parked child's, a merged one's not yet closed) does not keep the run, and stays where it is.
  - A run that is kept says why in one line above the board, naming `pnpm josh lane:close <N>` when a lane is the reason (an unanswered process probe is said as that); the same invocation prints no such line.
  - Before the run's record is written, the launch's own invocation is compared: any other is kept as still starting.
  - What was stopped and what was started are printed, one line each, before the board. A run owned by a session of your own is not replaced: the owner's pid is printed and the exit code is 1.
- Closing the board (Ctrl+C) closes only the board; the run goes on, and the board's last line says so. When the run stops for a person, the board prints the `claude --resume <session-id>` that reopens it.
- `--stop` stops the run in this repository — its supervisor, its sessions and its record — so the next `pnpm josh backlogrun` starts a new one.
  - Lanes still running are **not** stopped; their count and Issue numbers are printed, and each child finishes or is closed with `pnpm josh lane:close <N>`.
  - A run typed into a session of your own is owned by that session, which `--stop` does not signal: the owner's pid is printed, the record is kept and the exit code is 1. End that run from its session.
  - No Telegram is sent: the person who typed the stop is at the terminal.

**Output / exit codes:** prints the started pid, session and log path, then the board's exit code. Bad arguments, or an agent that cannot start, exit 1. `--stop` prints what it stopped and exits 0.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh backlogrun` in detail".

### `josh lane:limit`

Change a running `backlogrun`'s lane limit without stopping it. The run keeps the environment it started with, so `JOSH_LANE_LIMIT` cannot change under it; this writes an override onto the run's record, which every lane-limit read takes over the environment.

<!-- usage: lane:limit -->

```bash
pnpm josh lane:limit 8         # raise or lower the live run's limit to 8
pnpm josh lane:limit           # print the limit, the lanes in use and the free lanes
pnpm josh lane:limit --reset   # clear the override; JOSH_LANE_LIMIT applies again
```

<!-- /usage -->

- The next lane allocation uses the new limit. Raising it writes a `lane-limit` event, and the parent's `run:progress --wait` watcher wakes the parent within a minute to fill the freed lanes.
- Lowering it stops no running child: a lane that finishes is simply not refilled.
- The lanes in use are the open lane work trees, less two kinds that are not counted:
  - a vacant lane — no commit beyond the default branch, a clean tree, no child — under any run;
  - under a `--only` run, a lane with no child working in it whose issue the run neither names nor has launched — its tree and branch stay for the next run that names the issue.
- `run:board` prints `no free lane <used>/<limit>` and names each lane in use with its state (running, parked, idle).
- A limit above the nine port seats is shown and counted at the seats, as `JOSH_LANE_LIMIT` already is. A value that is not a positive integer is refused by the same rule.
- The override lives and ends with the run (`run:carry --end` removes it). With no run in progress, the command refuses and points at `JOSH_LANE_LIMIT`.

**Output / exit codes:** prints `lane limit <n> (<source>) · in use <n> · free <n>` and exits 0. Bad arguments, an invalid limit or no run in progress exit 1.

### `josh lane:restart`

Stop a running lane child and start its issue over in a fresh session — after correcting the Issue mid-run.

<!-- usage: lane:restart -->

```bash
pnpm josh lane:restart 3769   # prints the fresh child's pid
```

<!-- /usage -->

- In order: it claims the `in-progress` marker, stops the child's process tree, ends any cut it carried, stashes the lane's uncommitted work as `<N>: uncommitted work at lane restart`, dispatches a fresh `fullrun #<N>` that never resumes the stopped session, then comments the `stash:pop` line on the Issue. A `restart` event follows its `child-launch`.
- It is not a recovery: with no GitHub call between them, the stop and the dispatch fall inside `lane:await`'s 15 s re-confirm window, so `run:merge` never classifies the child — nothing is parked, and neither the failure count nor `CONSECUTIVE_OUTAGE_LIMIT` moves.

**Output / exit codes:** the fresh child's pid on stdout, exit 0. No lane, no running child or a refused marker: child untouched, exit 1. Work that cannot be stashed, or a failed dispatch, leaves the stopped child for `run:merge` and exits 1.

### `josh lane:withdraw`

Take a running lane child's issue out of the run for good — after deciding mid-run the issue should not be done.

<!-- usage: lane:withdraw -->

```bash
pnpm josh lane:withdraw 3769 --reason "folded into a broader issue"
```

<!-- /usage -->

- In order: it records a `withdraw` event, stops the child's process tree, stashes the lane's uncommitted work as `<N>: uncommitted work at lane withdraw`, closes the Issue as not planned with a `- Why: <reason>` comment, comments the `stash:pop` line, removes the `in-progress` marker and closes the lane. A child that had already ended is still withdrawn.
- The event comes first: `run:merge` books the child `withdrawn` from the stream before reading GitHub, so it is never resumed as an outage, parked `needs-decision` or counted as a failure, and the run moves on.

**Output / exit codes:** every explanation on stderr; exit 0 once the Issue is closed. A closed issue, no open lane or an unreadable state: nothing written, exit 1. Work that cannot be stashed leaves the Issue open and the lane in place, exit 1.

### `josh rule:value`

Print each delivered rule's **unaided compliance** (`scripts/rules/rule-value.ts`): per rule, the runs that reached it, the rate it was kept before its trigger fired, and the refusals the hook delivered.

<!-- usage: rule:value -->

```bash
pnpm josh rule:value
pnpm josh rule:value --refresh   # write the reading to the loop-head cache instead of stdout
```

<!-- /usage -->

- Transcripts are grouped by the run they belong to, so a lane's transcript counts with the parent that dispatched it rather than as a run of its own.
- It reports and never fails: an environment with no measurable transcript prints `no measurement targets` and exits zero.
- Printed from a cache at the `backlogrun` loop head (`josh backlog:offer`), refreshed in the background at most every 15 minutes.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh rule:value` in detail".
