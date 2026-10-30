# josh CLI — Command Reference

The commands you type by hand — the `developer` audience. Look a command up here rather than reading top to bottom. Commands needing Node tooling (ESLint, `tsc`, Vitest, Playwright) skip in a `basic` project and say why.

See also:

- [Automation command reference](josh-commands-automation.md) — the commands hooks, workflow runs, lanes and maintainers call.
- [Issue, epic, backlog and review command reference](josh-commands-backlog.md) — the commands a workflow run calls to file issues, track epics, plan a backlog and brief a review.
- [Command Catalog](josh-command-catalog.md) — auto-generated index of every command (name, aliases, synopsis, audience, side effects).

`josh` is available as `pnpm josh` (or `pnpm exec josh`) after running `josh init`. Run `pnpm josh help` to print a grouped summary in the terminal, and `pnpm josh help <command>` for one command's usage. How the dispatcher runs a command in kit's own checkout, and the shape a new script keeps: `docs/maintainers/josh-commands-rationale.md` → "How a command runs".

A `<!-- usage: … -->` span is generated — its summary line from the command's registry `description` and the rest from its `usage` (both in `scripts/josh/josh-commands-*.ts`), by `pnpm josh command:derive` — edit the entry, not the span.

## Development

These commands replace the corresponding `package.json` scripts; consumers need not add them.

### `josh gate`

<!-- usage: gate -->

Run lint, type check, spell check and unit tests concurrently.

```bash
pnpm josh gate
pnpm josh gate --verbose   # every check's output, passing ones included
pnpm josh gate --force     # re-run even on a tree already recorded green
pnpm josh gate --no-unit   # the static checks only (CI only)
```

<!-- /usage -->

Also runs [behavior](#josh-behavior), [unused namespace members](#josh-exportsunused), the [metrics ratchet](#josh-metrics) and the [lockfile policy](josh-commands-automation.md#josh-lockfilepolicy) (kit only).

- Static checks: `pnpm josh lint`, `cspell:dot`, `behavior`, `exports:unused`, `metrics` (kit only); the unit leg is `pnpm josh test:related`; the type check resolves to a toolkit `check:ci` / `check` when installed, else `pnpm josh check`.
- A tree recorded green is reused unless `--force` or the changed-file map moved; otherwise `lint`, `check`, `exports` and `metrics` are each reused while none of their inputs moved since they last passed silently (`scripts/gate/check-inputs.ts`), and `test:unit` while `josh test:related` would run no test for what moved (no test-read map, or one git can no longer diff against, runs it); the header reads `reused — inputs unchanged since it passed at <time>`.
- The other checks always run; `--force` reuses nothing.
- **Refuses to start when the scoped pair has not been green on this tree**: a unit-included local gate reads the record `josh review:brief` does and names `pnpm josh lint:related && pnpm josh test:related`. Not for `--no-unit` or `--force`; `JOSH_SCOPED_GREEN=0` turns it off.
- `--static-group=<lint|types|rest>` implies `--no-unit`: one part of the static set per CI matrix leg (`scripts/gate/gate-static-group.ts`).
- **On failure, a line per failed check with the command to re-run is printed just above the verdict**, so a `tail` keeps every failure.
- **The last line is the verdict, counting ran apart from skipped**: `✔ verification gate passed (6 checks) in 41.2s.`, or `⚠ verification gate not verified (0 ran, 6 skipped) in 0.2s.` — which exits `0` but writes no green record.
- Exit `1` if any check failed. Refuses any argument other than the three flags and `--static-group=<group>`.
- [`josh test:related`](#josh-testrelated) narrows the unit leg; CI runs the whole sharded suite regardless.
- **Each check waits for a place in a machine-wide core budget** (`scripts/gate/core-budget.ts`). Weighting: `docs/maintainers/josh-commands-rationale.md` → "`josh gate`'s core budget".

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh gate` in detail".

### `josh lint`

<!-- usage: lint -->

Check code with prettier and eslint (skips a tool a basic project lacks).

```bash
pnpm josh lint
pnpm josh lint --changed   # the branch's changed files — the gate's form
```

<!-- /usage -->

- `--changed` is what `josh gate` runs, on the gate's caches. It checks the whole tree in CI, when a toolchain, ignore, eslint or TypeScript configuration file changed, and when the change cannot be read.

### `josh lint:related`

<!-- usage: lint:related -->

Check only the changed files with prettier and eslint, and in kit the source guard tests (whole tree on fallback).

```bash
pnpm josh lint:related
pnpm josh lint:related scripts/thing.ts   # narrow by the given files instead
```

<!-- /usage -->

Keeps caches of its own, apart from the gate's.

- Changed set = branch diff plus untracked files (cache `.eslintcache.related`); flags are named rather than forwarded (`--fix` is reported ignored).
- A bare run after a green one lints only what moved since, main syncs included (`scripts/gate/since-green.ts`); nothing moved lints nothing and exits green; the branch diff when there is no comparable record (none, or one written under other tool versions or `NODE_ENV`), nothing lintable moved, or a toolchain or lint config moved (`scripts/gate/verification-inputs.ts`).
- Falls back to the whole tree (naming the case) when no changed file is lintable.
- In kit, a green bare run also reports a metrics total grown past the merge-base (`josh metrics --totals-only`) as a notice; it changes no exit code and writes no approval file.
- Also runs the fast byte-ceiling check on any changed agent-read document, sharing `document-byte-budget.ts`: a documentation update over its ceiling fails here in seconds, and the green record is withheld until both lint and the byte check pass.

### `josh lines`

<!-- usage: lines -->

Print a file's code lines against the max-lines limit and the headroom left.

```bash
pnpm josh lines scripts/hooks/format-edited-file.ts scripts/josh/josh-logic.ts
```

<!-- /usage -->

```
limit 300 code lines · near from 255
scripts/hooks/format-edited-file.ts  230/300 code lines (76%), 70 to spare
```

- Count is lint's own (`skipBlankLines` / `skipComments`); `near from` marks 85%. Never fails on a large file; non-zero means an unusable argument list.

### `josh bytes`

<!-- usage: bytes -->

Print an agent-read document's byte size against its ceiling and the headroom left.

```bash
pnpm josh bytes docs/josh-commands.md   # one document
pnpm josh bytes                         # scan: every budgeted document near its ceiling
```

<!-- /usage -->

The byte counterpart of `josh lines`.

```
docs/josh-commands.md  34492/36864 bytes · 2372 left
entry fullrun  227672/229376 bytes · 1704 left
```

- The scan closes with one row per workflow entry — the **primary** budget (`entry-read-budget.ts`), the total each entry reads against its ceiling. The per-document rows above are the fallback budget, for documents no entry reads.
- Path is repository-root-relative (a leading `./` is stripped); a path with no budget entry reads `not counted`.
- The ceiling is the next 4 KB block at or above the document's size (`document-byte-budget.ts`). Never fails — the gate enforces it.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh bytes` in detail".

### `josh metrics`

<!-- usage: metrics -->

Print repository-wide quality totals and durations, and fail when a total grew past the merge-base or a duration past its baseline.

```bash
pnpm josh metrics                             # print the totals and check them against the merge-base's
pnpm josh metrics --accept --reason "<why>"   # record this branch's growth and why
```

<!-- /usage -->

The totals: code and comment lines and the comment ratio under `scripts/` (non-test), the lines of `CLAUDE.md` and `prompts/**/*.md`, the number of `*:guard` commands, and the AI cost in bytes.

- **A ratchet, and a step of [`josh gate`](#josh-gate)**: exits `1` when a total grew past the merge-base's; the only way up is `--accept --reason "<why>"`, once — `josh ship` re-records a later growth of a total the approval names. History: `docs/maintainers/josh-commands-rationale.md` → "`josh metrics`' totals".
- **kit only**: a consumer's gate leaves the step out.
- The prose density is held too, over `README.md`, `docs/`, `prompts/` and `.claude/skills/`. It counts paragraphs over 400 characters, and bold spans beyond the first in each section.
- Code lines are lint's own `max-lines` count (one lower than `josh lines` on a `#!` file); a comment line is any other non-blank line.
- **Durations** fail past +10% of this machine's baseline; the gate and unit durations only warn where another lane worked or the load average passed the cores during most of the gates measured; a gate times no startup — `docs/maintainers/josh-commands-rationale.md` → "`josh metrics`' durations".

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh metrics` in detail".

### `josh format`

<!-- usage: format -->

Format code with prettier and eslint (skips a tool a basic project lacks).

```bash
pnpm josh format
```

<!-- /usage -->

A tool the project lacks is skipped for the reason `josh lint` prints.

### `josh cspell:dot`

<!-- usage: cspell:dot -->

Run spell check including dotfiles.

```bash
pnpm josh cspell:dot   # includes dotfiles
```

<!-- /usage -->

- Runs with `--no-progress`: only the unknown-word lines and the summary print.

### `josh check:related`

<!-- usage: check:related -->

Run related lint, type and dotfile spelling checks in parallel, and the unit tests once lint passes.

```bash
pnpm josh check:related
pnpm josh check:related --full   # whole outputs
```

<!-- /usage -->

Each check runs through its own `pnpm josh` command, preserving its core-budget reservation, green record or cache. The command waits for every check it started, ends with one verdict line naming every check that failed, and exits non-zero if any fails.

`test:related` starts once `lint:related` passes; on a failed `lint:related` it is not run: its section reads `=== test:related: not run ===` and the verdict line adds `(not run: test:related)`. A reused `lint:related` lets it start at once.

A section prints its check's last 5 lines, 40 on a failure; the log keeps the whole output.

A check whose green record still describes the tree is not run: its section reads `=== <check>: reused ===` and the verdict line lists it as `(reused: …)`. A check that failed last time left no record and runs again.

`lint:related` and `test:related` read their own scoped records; the type check and `cspell:dot` read the gate's per-check records, which `check:related` also writes when they pass.

A record holds only for the same changed files (a `.josh/` record included), merge base, and tool and environment fingerprint; any moved file reruns `cspell:dot`. In kit, a metrics growth notice from `lint:related` is printed again above that verdict line, which then says the ship's pre-detach stops on it and names `josh metrics --accept`.

When a `josh test:pinned` launched on the current tree has already answered with unpinned places the ship's pre-detach would stop on, they are printed there too, with the `josh ship --review … --unpinned-ok "<reason>"` form, so the first ship can carry the reason; a check this run did not start, if still running, prints nothing and is not waited on.

In a lane child, a tree a round-1 fix moved first restarts the background `josh test:pinned`. That check is waited for after the four, until it answers, ends, the tree moves again, or 240 seconds pass; only an answer on the current tree is printed.

### `josh behavior`

<!-- usage: behavior -->

Check the current run's recorded transcript against the behavior assertions (no model call).

```bash
pnpm josh behavior
```

<!-- /usage -->

One of `pnpm josh gate`'s checks.

- **The data is what every run already writes**: each session's transcript under `~/.claude/projects/**/*.jsonl`; an assertion read off it is deterministic and calls no model — what joshuafolkken/kit#1922 removed the slow `josh eval` path for lacking.
- **The scope is the current run** — the newest session transcript.
- **A run with no transcript passes** without the skip marker, so CI never withholds the gate's green record.
- **The assertions**, each verified green against past runs; a Bash call refused before it ran breaks none:
  - `no-direct-git-index-mutation` — `git add` / `git commit` / `git rm --cached` / `git restore --staged` must go through `pnpm josh git` (dry runs excluded).
  - `no-direct-pr-create` — a pull request must be opened with `pnpm josh pr`, never `gh pr create` / `gh pr new` or a `gh api` POST to the pulls path; the matcher is the `direct-pr-create` guard's own.
- A break prints which run and which point it broke at.
- The manual `josh eval` is untouched.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh behavior` in detail".

### `josh exports:unused`

<!-- usage: exports:unused -->

Report exported namespace members nothing reads (kit only; a consumer project skips it).

```bash
pnpm josh exports:unused
```

<!-- /usage -->

One of `pnpm josh gate`'s checks.

- **Why its own check**: the namespace convention (`const git_prompt = { confirm_push }` exported as `export { git_prompt }`) keeps the namespace imported everywhere, so an ordinary unused-export tool never sees an unused member.
- **Scanned**: `snake_case`, un-annotated object-literal constants exported through a bare `export { x }` in a `.ts` file of the `tsconfig.json` program. An `UPPER_CASE` constant, a type-annotated table, a public `index.ts` entry and a test file declare no namespace it checks.
- **A use is any reference the checker resolves to the member** (property access, destructuring, string-keyed access, `vi.spyOn(namespace, 'member')`) from any file, tests included.
- **A namespace that escapes whole counts as fully used**: spread, passed as a value, read through a computed key, or re-exported.
- Exit `1` with one `path:line  namespace.member` line per finding; remove the member, and its declaration if nothing in its file uses it.
- **kit only**: a consumer reads its namespaces from `.svelte` files and routes this program does not see, so it skips with a notice.

### `josh test:unit`

<!-- usage: test:unit -->

Run unit tests with Vitest (without Vitest: a basic project runs its own test script, others skip; fails when Vitest has no tests).

```bash
pnpm josh test:unit
```

<!-- /usage -->

Without `vitest` it skips with exit 0; a `basic` project runs its [`test` script](./setup/basic.md#3-verify). `vitest` with **no** `*.{test,spec}.{ts,js}` file fails.

- Guards (kit's own checkout): a unit test that reaches the network or writes into the suite's repository fails; fix the test (mock the read, clear git location env, carry identity on `-c`).
- **The suite runs as two Vitest projects** (`vitest.config.ts`): `pure` with `isolate:false` and `isolated`, with the same green condition.
- **A setup file silences the real streams for each test body** (`tools/test/test-stdout-guard.ts`); `console.*` is untouched and the streams are restored after each test.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh test:unit` in detail".

### `josh test:related`

<!-- usage: test:related -->

Run only the unit tests related to the changed files (full suite on fallback).

```bash
pnpm josh test:related
pnpm josh test:related scripts/thing.ts   # narrow by the given files instead
pnpm josh test:related --touched          # only the diff's tests and its modules' same-named ones
pnpm josh test:related --silent           # flags are forwarded to vitest
```

<!-- /usage -->

`josh gate` runs it as its unit leg.

- `--touched` is the implementation loop's re-check: the diff's test files (or the given files') plus each changed module's colocated `foo.test.ts` / `foo.*.test.ts`, with no test-read map and no import graph (`scripts/test/test-related-touched.ts`). It leaves no green record, so `josh review:brief` and the gate's reuse count only a full-reach run; the lane ledger records it as `touched`.

- Changed set handed to `vitest related`; value-taking flags must be `--flag=value`. Falls back to the whole suite (naming which case) when a changed non-code file has no map or no recorded reader and is new since the map's tree, or a changed file is one every test depends on (counting only files this change moved); a narrowed run matching nothing prints `No test files found` and exits 0.
- A changed module the vitest config or a setup file imports (`IMPORTED_BY_EVERY_TEST` in `scripts/test/whole-suite-files.ts`) runs only the test files importing it directly, and none when no test does; `josh gate`'s `test:unit` passes `--keep-whole-suite` to run the whole suite for it, as CI does. `josh test:pinned`'s probe narrows by the same rule and leaves out the same heavy files.
- An entries-only edit of `tools/test/pure-files.ts` runs the moved entries and the list's own tests; a `.josh/` run record reaches only a test that read it by name.
- A changed non-code file narrows to the tests that read it, per the test-read map a whole-suite `josh test:unit` records (`<git-common-dir>/josh/test-read-map.v<version>.json`, one file per map version so lanes on different kits keep their own; a write removes another version's file unwritten for a week); with no map the changed set is the branch diff.
- A change of only non-code files the map's tree held and no test read runs no test: it says why and exits 0.
- The core claim is taken once the scope resolves: a narrowed run claims one worker per 285 test files its imports reach (about 30 s each), between `MIN_WORKERS` and `josh test:unit`'s share, plus vitest's process; the whole suite, or no import graph, claims `josh test:unit`'s full width (`scoped_unit_weight` in `scripts/gate/gate-plan.ts`).
- `--maxWorkers` is at most the claim less vitest's process. Each vitest pass claims for itself, the no-base pass (`scripts/test/test-no-base.ts`) by its own files (`scripts/test/test-related-claim.ts`). A run that reaches no test claims nothing; under `josh gate` the gate's claim covers it.
- A file that differs only from the map's tree joins only as code whose text names a file this change moved.
- A bare run after a green one reads only what moved since, main syncs included, plus the branch's own test files; nothing moved runs no test. The whole change when no record compares (none, or other tools, `NODE_ENV` or `TZ`), a non-code file moved (the map cannot see its read), or a toolchain, TypeScript or test-runner config moved (`scripts/gate/verification-inputs.ts`).
- In kit, after a green run, the related tests of each changed code file that names the base branch's resolution (`change_base`, `default_branch`, `diff_main`, a quoted `main`) run again in a checkout shaped like CI's — detached, one commit deep, no local `main`, `origin` kept — and a failure there fails the run (`scripts/test/test-no-base.ts`). A change that names none builds no checkout.

### `josh test:declared`

<!-- usage: test:declared -->

Report whether the working-tree change needs a test (required/exempt/satisfied); --match checks Step 0 declarations on stdin.

```bash
pnpm josh test:declared
pnpm josh test:declared --match   # check Step 0 declarations on stdin
pnpm josh test:declared --help    # print usage, including the --match stdin form
```

<!-- /usage -->

Decided from changed paths alone; `pnpm josh git -y` refuses on `required`. An unknown flag is refused with the usage, as `josh time` does.

`--match` checks each `Test: <type> — <path>` declaration against the change set, printing `match` / `type-mismatch` / `path-missing` / `test-not-created` per line; any mismatch exits non-zero.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh test:declared` in detail".

### `josh test:red`

<!-- usage: test:red -->

Run the changed unit tests against the pre-fix tree (merge-base worktree) and report red/green/no-test/stopped/test-only.

```bash
pnpm josh test:red   # red, green, no-test, stopped or test-only
```

<!-- /usage -->

On an Issue declaring `- 種別: 不具合`, `pnpm josh git -y` refuses `green`.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh test:red` in detail".

### `josh test:pinned`

<!-- usage: test:pinned -->

Revert each changed hunk outside tests and fixtures only they reach, and replace each added file's top-level function bodies with a throw, in a HEAD worktree, run the related tests, and list what no test went red on.

```bash
pnpm josh test:pinned                       # unpinned <file>:<line> lines; unchecked counted per reason
pnpm josh test:pinned --max 5               # check at most 5 hunks; the rest count as unchecked
pnpm josh test:pinned --record <token>      # also leave the answer, under the launch token, for run:review --join
pnpm josh test:pinned --origin pre-detach   # name what started the run on its lane ledger row (default manual)
pnpm josh test:pinned --first-unpinned      # start no probe once one hunk is unpinned; the rest count as unchecked
```

<!-- /usage -->

Exits non-zero when any checked hunk is unpinned; an unchecked hunk alone does not fail the run.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh test:pinned` in detail".

### `josh test:e2e`

<!-- usage: test:e2e -->

Run E2E tests with Playwright (skips when absent or no e2e files).

```bash
pnpm josh test:e2e
```

<!-- /usage -->

Runs reserve CPU cores and measured memory for Playwright, Chromium and the web server through
the shared admission budget. Skipped runs reserve nothing.

### `josh test`

<!-- usage: test -->

Run unit and E2E tests.

```bash
pnpm josh test
```

<!-- /usage -->

`josh test` is a **composite command**; pass runner flags to the stage that understands them:

```bash
pnpm josh test:e2e --workers=1   # ✅ reaches Playwright
pnpm josh test:unit -u           # ✅ reaches Vitest
pnpm josh test:unit -u <filter>  # ✅ the filter moves in front of -u, which takes an optional type
pnpm josh test --workers=1       # ❌ exits 1, naming test:unit and test:e2e
```

See [Composite commands and extra arguments](#composite-commands-and-extra-arguments).

### `josh check`

<!-- usage: check -->

Type-check with tsc (skips a basic project with no TypeScript to check).

```bash
pnpm josh check
```

<!-- /usage -->

A listed, uninstalled tool fails. SvelteKit type-checking is not part of kit's framework-agnostic `josh` CLI: SvelteKit projects get `josh-app check` / `josh-app check:ci` from [`@joshuafolkken/app-kit`](https://github.com/joshuafolkken/app-kit).

### `josh port`

<!-- usage: port -->

Print the PORT_SEED-resolved dev or preview port.

```bash
pnpm josh port dev       # 5173 with no seed set
pnpm josh port preview   # 4173 with no seed set
```

<!-- /usage -->

- `PORT_SEED` is a personal `.env` integer; the offset on both ports is `seed × 10 + lane`, where `lane` is `JOSH_LANE_SEAT` (`0` for the main tree).

- Seed 1 at seat 0 gives dev 5183, preview 4183. Distinct seeds stay in disjoint bands (seed 1 is `10..19`), seats `1..9`. Invalid seed (non-integer, negative, or above `99`) is a hard error. Only `PORT_SEED` and `PLAYWRIGHT_REUSE_SERVER` cross from `.env` into the process.

A `package.json` script substitutes the output into a command line, e.g. `"dev": "DEV_PORT=$(josh port dev) && vite dev --port $DEV_PORT --strictPort"`.

- Call `josh`, **not** `pnpm josh` (the wrapper writes noise onto the read stream), and use `VAR=$(...) && cmd`.
- Success prints the number only; a bad argument prints usage to stderr and exits `1`. A busy port fails loudly — `--strictPort` holds vite to it. See [Local E2E aborts with "already used"](./troubleshooting.md#local-e2e-aborts-with-httplocalhost5173-is-already-used).

### Composite commands and extra arguments

A few `josh` commands chain several steps behind one name, as a fixed shell script that cannot expand appended arguments.

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

The assign-then-run shape [`josh port`](#josh-port)'s scripts use: assigning first makes a resolver's failure the script's exit status, since a failed substitution does not stop the command it feeds.

## Project

Commands for setting up and maintaining a project.

### `josh profile`

<!-- usage: profile -->

Show the project profile and the reason for it.

```bash
pnpm josh profile
```

<!-- /usage -->

A saved `josh.profile` takes precedence; `--profile` overrides it. A `basic` project also gets a `compat: profile: static (…)` line for a `ci.yml` synced before the profiles were renamed ([#2829](https://github.com/joshuafolkken/kit/issues/2829)) still recognizes it.

### `josh start`

<!-- usage: start -->

Set a project up for the GitHub Issue workflow, from git init to the setup PR.

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

`kickoff new` works once the setup is on `main`. For a project without the workflow or a re-run use `josh init`: [init.md → `josh init` or `josh start`](./init.md#josh-init-or-josh-start) compares the two and lists the steps per starting state.

**Prerequisites:** the [gh CLI](https://cli.github.com/), signed in, and a Git author identity for a run that commits ([Tell Git who you are](./setup/prerequisites.md#4-tell-git-who-you-are)); without either it stops before changing anything.

The `full` profile's pre-push hook runs `josh audit`, which needs `osv-scanner`. A run that pushes fetches the pinned scanner before its first step (as `pnpm josh audit:provision --force` does); where the fetch fails and no scanner is on `PATH`, it stops before changing anything and prints the cause.

**Steps**, printed as `[n/N]` while they run:

1. `git init` on `main` — skipped when Git already exists
2. The same setup `josh init` runs, with the confirmed profile
3. The initial commit of every file — only without commits
4. `gh repo create <directory name> --private` (or `--public`) and push `main` — only without an origin
5. The missing workflow and release-classification labels; existing ones stay. A new label is defined in `scripts/issue/issue-labels.ts` and added to `REPOSITORY_LABELS`, or exempted with a reason in `EXEMPT_FROM_PROVISIONING`; other modules import its constant, and `issue-label-scan.test.ts` fails on a label the scripts use that neither list holds
6. The setup pull request — only while `main` has commits but no kit: an Issue, a commit of only kit's files on its branch, and the pull request. It never merges

What `--dry-run` prints: [init.md → Preview with `--dry-run`](./init.md#preview-with---dry-run).

**Existing state:** an existing GitHub origin is never replaced or pushed to; a re-run after a failed commit hook resumes step 6. A non-GitHub origin, commits on a branch other than `main`, or — once the repository has a commit — a dirty working tree is refused before any change; the setup branch a failed commit left is exempt.

**Output / exit codes:** exits 0 when every step has run. A failed step exits 1 and prints the step it stopped at, the completed steps and the cause.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh start` in detail".

### `josh init`

<!-- usage: init -->

Initialize config in a new project.

```bash
pnpm josh init   # create/merge config files, install and format (--no-install skips both, --dry-run only prints the plan)
```

<!-- /usage -->

**Output / exit codes:** exits non-zero inside the distribution package's own repository, where it writes nothing, and when its `pnpm install` fails.

See [init.md](./init.md) for the full file list and [`josh doctor`](#josh-doctor) for the settings reports.

### `josh sync`

<!-- usage: sync -->

Sync config files.

```bash
pnpm josh sync   # overwrite managed files
```

<!-- /usage -->

Run after upgrading `@joshuafolkken/kit`. Also realigns `devEngines.packageManager.version` with the `packageManager` pin, and creates missing labels as [`josh start`](#josh-start) does.

**Output / exit codes:** exits non-zero inside the distribution package's own repository, where syncing would overwrite the source with its own derived templates.

See [sync.md](./sync.md) for the full file list.

### `josh uninstall`

<!-- usage: uninstall -->

Remove what kit added to a project and list what is left to review by hand.

```bash
pnpm josh uninstall         # show the plan, then ask
pnpm josh uninstall --yes   # remove without asking
```

<!-- /usage -->

It prints three lists — remove, keep, review by hand — and removes only the first.

- **Remove:** each distributed file still byte for byte what kit writes, the `@joshuafolkken/kit` dependency and the `josh.profile` record in `package.json`, and the git hooks lefthook installed (`lefthook uninstall`, where `lefthook.yml` is one kit wrote or merged into). A directory left empty goes too.
- **Keep:** a distributed file that differs from what kit writes (edited, or one of your own that kit merged entries into).
- **Review by hand:** the `package.json` entries kit merges in (`scripts.josh`, `devDependencies.prettier`, …) that the project still holds, `sonar-project.properties` / `.aikido` when present, and `.gitignore` — deleting it would un-ignore `.env` and `node_modules`. They are never changed: `josh init` kept no record of the values it found.

`--profile basic|full` names the profile whose files are compared, instead of the recorded one. Without a terminal and without `--yes`, the run is a preview that removes nothing.

**Output / exit codes:** exits non-zero inside the distribution package's own repository, where it removes nothing. Files are compared with the installed kit version; `node_modules`, `pnpm-lock.yaml` and GitHub are untouched — see [Remove kit from a project](./how-to/uninstall.md).

### `josh adopt`

<!-- usage: adopt -->

Upgrade the @joshuafolkken toolkits and other dependencies here, open the PR.

```bash
pnpm josh adopt
pnpm josh adopt --dry-run   # report the steps without touching anything
```

**Options:**

- `--dry-run` — report the plan without writing.

<!-- /usage -->

The consumer-side counterpart of [`josh propagate`](josh-commands-automation.md#josh-propagate).

Steps: working-tree check, `pnpm add -D <toolkit>@latest` per toolkit, `pnpm josh sync`, `pnpm install`, `pnpm josh latest`, [`josh gate`](#josh-gate), open issue, `pnpm josh git`, return to the default branch.

**Output / exit codes:** exits `0` on a skip; a failing step exits non-zero, and one before `pnpm josh git` opens no pull request. Merging is [`josh followup`](josh-commands-automation.md#josh-followup)'s job.

---

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh adopt` in detail".

## Workflow

AI-assisted git and notification helpers used in the day-to-day development loop.

### `josh git`

<!-- usage: git -->

Git workflow helper.

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

With no issue argument the issue comes from the branch name (`<N>-<slug>`).

**Behavior:** returns once the PR is open and prints its URL, without waiting for checks (`josh followup` does). Re-running on the same branch makes a follow-up commit and reuses the open PR. Each push is bounded at 120 s and retried once on timeout, the failure naming the command to re-run by hand.

Related: [`josh followup`](josh-commands-automation.md#josh-followup), [`josh pr`](#josh-pr).

### `josh pr`

<!-- usage: pr -->

Create PR only (skip commit and push).

```bash
pnpm josh pr   # open the PR for the current <N>-<slug> branch
```

<!-- /usage -->

The recovery counterpart to `josh git` for a branch already committed and pushed; the issue comes from the branch name.

**Behavior:** reports an existing open PR for the branch instead of opening a second one.

### `josh review:findings`

<!-- usage: review:findings -->

Count review findings by category from the observation ledger.

```bash
pnpm josh review:findings
```

<!-- /usage -->

The reader over what `josh review:record` wrote.

**Behavior:** counts only `- rf:` lines, ignoring `- k:` observation lines. `none` sentinel lines are reported as the zero-finding round count, not tallied. A ledger with no finding lines prints `no review findings recorded yet`.

Related: [`josh review:record`](josh-commands-automation.md#josh-reviewrecord).

### `josh review:stops`

<!-- usage: review:stops -->

List the review findings that stopped a josh ship over a period, by kind, file:line and first sentence.

```bash
pnpm josh review:stops --period 30   # the last 30 days (default 7)
```

<!-- /usage -->

Reads `josh/review-stops.jsonl` in the git common directory, which `josh ship` appends to on each review stop.

### `josh main:sync`

<!-- usage: main:sync -->

Checkout default branch, pull latest, and prune merged remote-gone branches (refuses inside a lane).

```bash
pnpm josh main:sync
```

<!-- /usage -->

**Behavior:** pulls with `--ff-only` (the opposite of [`josh main:merge`](#josh-mainmerge)), named by the command rather than read from git config, then prunes local branches whose upstream is gone, that are merged, and that no work tree has checked out.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh main:sync` in detail".

### `josh main:merge`

<!-- usage: main:merge -->

Merge origin default branch into the current branch.

```bash
pnpm josh main:merge
```

<!-- /usage -->

**Behavior:** merges with an explicit strategy rather than rebasing, so a diverged branch merges cleanly without a force push. A conflict only on the files `scripts/git/main-merge-regenerate.ts` lists is resolved and committed; any other conflict, or uncommitted work on an incoming path, fails.

---

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh main:merge` in detail".

## Versioning

### `josh version`

<!-- usage: version -->

Show kit versions; --upgrade updates the global and project install.

```bash
pnpm josh version
pnpm josh version --upgrade   # upgrade global + project to latest, then re-run fix-gh-packages
```

**Options:**

- `--upgrade` — upgrade both the global install (`pnpm add -g`) and the project devDependency (`pnpm add -D` + `fix-gh-packages`); already-current or not-installed targets are skipped.

<!-- /usage -->

Shows the global, project and latest published versions, plus the **running binary**. A stale install gets a `Run:` hint; a shadowing `josh` on `PATH` points to [`josh doctor --fix`](#josh-doctor).

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh version` in detail".

### `josh ranges`

<!-- usage: ranges -->

Check that every published dependency range still resolves for a consumer and no peer range falls below an installed toolkit.

```bash
pnpm josh ranges
```

<!-- /usage -->

Each range is probed with `pnpm view <name>@<range> version` under safe-chain's shims. The peer check applies in a package built on a `@joshuafolkken/*` toolkit.

**Output / exit codes:** fails closed — a probe that cannot answer is unresolvable. Probing `@joshuafolkken/*` needs `NODE_AUTH_TOKEN` (`export NODE_AUTH_TOKEN=$(gh auth token)`).

---

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh ranges` in detail".

## Maintenance

### `josh doctor`

<!-- usage: doctor -->

Diagnose PATH shadowing of the global josh and show the discovered repository map (--fix reclaims a stale shim).

```bash
pnpm josh doctor           # diagnose only
pnpm josh doctor --fix     # reclaim the global josh by removing a stale kit shim
pnpm josh doctor --ports   # also print the per-repository port-seed table
```

**Options:**

- `--fix` — remove a shadowing binary **only if it is a kit shim** (its body references `@joshuafolkken/kit` or the removed `install-bin` script); any other binary is left and reported for manual review. Also the one-shot recovery for an old project that re-created the global shim.
- `--ports` — additionally print the port-seed table (see below).

<!-- /usage -->

It reports the running binary, the `josh` first on `PATH` and the pnpm-global install; in a kit consumer it adds a **Consumer setup** section and repository settings, including the [`josh ruleset:check`](josh-commands-automation.md#josh-rulesetcheck) report. None of these fails the command or changes a setting.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh doctor` in detail".

#### The discovered repository map

`doctor` prints the **repository map** — every checkout on this machine of the same GitHub owner as the current repository, with its local path — so other commands can locate a sibling.

```text
Repositories (same owner, discovered next to this one):
  joshuafolkken/app-kit   /Users/example/Development/app-kit
  joshuafolkken/kit       /Users/example/Development/kit
```

Discovery scans the parent directory one level deep and keys each work tree by its `origin` remote's `owner/repo`. **The directory name is never used as the repository name**.

**The owner restriction is unconditional and cannot be overridden.** Only repositories whose owner equals the current repository's owner enter the map, so tooling can never write to someone else's repository. Remotes on any host other than GitHub are excluded before the owner is even compared, as are directories with no remote at all.

`JOSH_REPO_PATHS` is the escape hatch for non-sibling or twice-checked-out repositories, set in the personal `.env`:

```bash
JOSH_REPO_PATHS=joshuafolkken/game-kit=/Users/example/elsewhere/game-kit,joshuafolkken/kit=/Users/example/kit-review
```

Entries are `owner/repo=/absolute/path`, comma-separated; an override wins over the discovered path. It is a way in, never a way around: an override naming a different owner is dropped exactly like a discovered sibling would be, and a malformed entry is dropped rather than failing the command. Outside a git work tree no map is printed, since there is no owner to anchor it.

With `--ports`, `doctor` additionally prints each discovered repository's **port seed** and its resolved dev / preview ports, and flags any seed held by more than one repository:

```text
Port seeds (dev / preview, and repositories sharing one):
  joshuafolkken/app-kit   seed 0   dev 5173   preview 4173
  joshuafolkken/kit       seed 1   dev 5183   preview 4183
  ⚠ seed 0 is shared by: joshuafolkken/app-kit, joshuafolkken/game-kit
```

It never rewrites a `.env`; the report names the clash and a person resolves it. A malformed seed is reported as `PORT_SEED could not be read`.

Detail: `docs/maintainers/josh-commands-rationale.md` → "The discovered repository map in detail".

### `josh audit`

<!-- usage: audit -->

Run security audit.

```bash
pnpm josh audit
```

<!-- /usage -->

The scanner is looked up on `PATH`, then in the `josh audit:provision` cache (`node_modules/.cache/josh-tools/`) — in a linked work tree, the primary checkout's cache, so every work tree shares one binary and one failed-download record. With neither the audit exits non-zero and prints how to get one — never skipped.

### `josh overrides`

<!-- usage: overrides -->

Check pnpm overrides for drift.

```bash
pnpm josh overrides          # verify overrides unchanged
pnpm josh overrides --save   # snapshot current merged overrides
```

**Options:**

- `--save` — write the current merged overrides to `.overrides-snapshot.json` (gitignored); later runs compare against it and exit non-zero on any add, removal, or change.

<!-- /usage -->

Checks effective overrides from `pnpm-workspace.yaml` against a saved snapshot and reports ignored `pnpm.overrides` entries in `package.json` separately (pnpm 11 and 12 do not apply that field). An empty `pnpm.overrides` is never treated as "no overrides" without reading the workspace.

### `josh latest`

<!-- usage: latest -->

Update dependencies, run security audit, then update pnpm.

```bash
pnpm josh latest   # full update (update + audit + pnpm)
```

<!-- /usage -->

The pnpm bump runs last, so a failed bump still lets the update and the audit finish but leaves the run unrecorded and exits non-zero.

`josh latest` never lowers a version — a would-be downgrade rolls the whole tree back — and fails when `pnpm-lock.yaml` no longer honours an unconditional override. Whether to update is [`josh latest:scope`](josh-commands-automation.md#josh-latestscope).

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh latest` in detail".

#### `josh latest:corepack`

<!-- usage: latest:corepack -->

Update pnpm on the current major while preserving the integrity pin.

```bash
pnpm josh latest:corepack   # update pnpm only
```

<!-- /usage -->

Pins `packageManager` to the newest release on the current major with `pnpm self-update`, aligning `devEngines.packageManager.version`. A failure restores `package.json` and exits `1`.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh latest:corepack` in detail".

#### `josh latest:update`

<!-- usage: latest:update -->

Update all dependencies to latest.

```bash
pnpm josh latest:update   # update dependencies only
```

<!-- /usage -->

Runs `pnpm update --latest`, skipping held-back and overridden packages; a would-be downgrade restores `package.json` and the lockfile. It also moves the safe-chain installer pin in every workflow and composite action that carries it.

When the update moved `@playwright/test`, it installs the browsers (`JOSH_PLAYWRIGHT_BROWSERS` widens the list); a failed install stops `josh latest`.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh latest:update` in detail".

## AI tools

Helpers for AI-assisted development workflows.

### `josh backlogrun`

<!-- usage: backlogrun -->

Start a backlogrun in the background and show its board; with one already running, only show the board, or replace it when it is idle and the invocation differs; --stop stops it; --restart replaces its processes and keeps its record.

```bash
pnpm josh backlogrun                 # start with the configured provider, then show the board
pnpm josh backlogrun 3437 --only     # the arguments go to backlogrun as typed
pnpm josh backlogrun --agent codex   # start in Codex
pnpm josh backlogrun --stop          # stop the run in this repository
pnpm josh backlogrun --restart       # replace the run's processes, keeping its record
```

<!-- /usage -->

The board is [`josh run:board`](./josh-commands-run.md#josh-runboard). The agent runs in the main checkout, its output going to a log file.

To default to Codex, add `JOSH_AGENT_PROVIDER=openai` to the project's `.env`. Provider selection is `--agent claude|codex` first, then the exported `JOSH_AGENT_PROVIDER`, then `.env`, then Claude Code (`anthropic`).

The environment accepts `anthropic|openai`; an unset or blank value selects Claude, and other values are refused with a reason unless `--agent` overrides them. Codex uses the existing OpenAI role profiles. Changing this setting only affects a new launch: showing an existing run or `--restart` keeps its recorded provider.

- The arguments are the `backlogrun` keyword's own: named Issues, `--only`, `--max <n>`, `--idle <minutes>`. A bare number is read as `#<n>`, since an unquoted `#` starts a shell comment.
- A run already going here is never joined by a second: the board is shown, and each named Issue is printed as a `run:add` line to add it by hand.
- A record left with no process running it — a launch that died before ending it — is ended as `--stop` ends it and the typed invocation is started, the same one or a different one. It is kept, with the reason in one line and exit code 1, when:
  - its `run:wake` supervisor is not proven gone, since it may still wake a successor (`--stop` ends both);
  - a session cut handed it to a successor (`--restart` continues it);
  - it owes its retrospective, a child is working in a lane, or it cannot be read.
- An idle run is replaced by a different invocation. The run going is stopped as `--stop` stops it and the typed one is started when all of these hold:
  - the typed invocation differs from the one the run was started with — the same invocation, a bare one over a bare one included, only shows the board;
  - the run is watching: its backlog drained, it has launched no child since, and it owes no end-of-run retrospective (`JOSH_RETROSPECTIVE`);
  - no child is working in a lane — a lane left open with no child in it (a parked child's, a merged one's not yet closed) does not keep the run, and stays where it is.
  - A run that is kept says why in one line above the board, naming `pnpm josh lane:close <N>` when a lane is the reason (an unanswered process probe is said as that); the same invocation prints no such line.
  - Before the run's record is written, a different launch's invocation is kept as still starting.
  - What was stopped and what was started are printed, one line each, before the board. A run owned by a session of your own is not replaced: the owner's pid is printed and the exit code is 1.
- Closing the board (Ctrl+C) leaves the run going. When the run stops for a person, the board prints the `claude --resume <session-id>` that reopens it.
- `--stop` stops the run's supervisor, sessions and record, so the next `pnpm josh backlogrun` starts a new one.
  - Lanes still running are **not** stopped; their count and Issue numbers are printed, and each child finishes or is closed with `pnpm josh lane:close <N>`. To halt them without discarding anything, `pnpm josh lane:pause --all`.
  - A run typed into a session of your own is owned by it, and `--stop` does not signal it: the owner's pid is printed, the record is kept and the exit code is 1. End it from that session.
  - No Telegram is sent.
- `--restart` stops what `--stop` stops but keeps the record, so a new supervisor continues the run. New supervisor code on main reloads between passes ([`run:wake`](./josh-commands-run.md#josh-runwake)).

**Output / exit codes:** prints the started pid, session and log path, then the board's exit code; bad arguments or an agent that cannot start exit 1. `--stop` prints what it stopped and exits 0; a `--restart` it cannot make exits 1.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh backlogrun` in detail".

### `josh lane:limit`

<!-- usage: lane:limit -->

Change a live backlogrun’s lane limit without stopping it, or print the limit, lanes in use and free lanes.

```bash
pnpm josh lane:limit 8         # raise or lower the live run's limit to 8
pnpm josh lane:limit           # print the limit, the lanes in use and the free lanes
pnpm josh lane:limit --reset   # clear the override; JOSH_LANE_LIMIT applies again
```

<!-- /usage -->

The run keeps the environment it started with, so this writes an override onto the run's record, which every lane-limit read takes over `JOSH_LANE_LIMIT`.

- The next lane allocation uses the new limit. Raising it writes a `lane-limit` event, and the parent's `run:progress --wait` watcher wakes within a minute to fill the freed lanes.
- Lowering it stops no running child; a lane that finishes is not refilled.
- The lanes in use are the open lane work trees whose child is working, or whose process probe did not answer. A stopped lane keeps its tree and changes; its port seat becomes free once its owned processes and listeners are gone.
- Every dispatch atomically acquires a seat and updates `.env` and the child's environment before starting. Kept trees are prioritized within the same free-seat limit as fresh launches.
- A live or suspended lane child or listener keeps its seat; idle shells and portless helpers do not. Unreadable process ownership or ports block allocation with a reason. A saved `.env` seat alone is no reservation, so older stopped trees need no manual cleanup.
- A lane whose child and every process under it are stopped (`lane:pause`, `kill -STOP`) is not counted either; `lane:resume` continues it in place, and it is counted again.
- `run:board` leads the waiting row with `🧵 <used>/<limit>`; it counts the lanes in use and does not name them — some may be no board row, such as a lane an earlier run left.
- The limit counts lanes, not memory or usage: the driver opens no lane under memory pressure or a Claude usage limit, and `run:board` leads the waiting row with `🧠` or `🪫 <reset>`.
- A limit above the nine port seats is counted at the seats, as `JOSH_LANE_LIMIT` is; a value that is not a positive integer is refused.
- The override lives and ends with the run (`run:carry --end` removes it). With no run in progress, the command refuses and points at `JOSH_LANE_LIMIT`.

**Output / exit codes:** prints `lane limit <n> (<source>) · in use <n> · free <n>` and exits 0. Bad arguments, an invalid limit or no run in progress exit 1.

### `josh lane:restart`

<!-- usage: lane:restart -->

Stop a running lane child, stash its uncommitted work and re-dispatch its issue in a fresh session — not counted as an outage or a failure.

```bash
pnpm josh lane:restart 3769   # prints the fresh child's pid
```

<!-- /usage -->

- In order: claims the `in-progress` marker, stops the child's process tree, ends any cut it carried, stashes the lane's uncommitted work as `<N>: uncommitted work at lane restart`, dispatches a fresh `fullrun #<N>` that never resumes the stopped session, then comments the `stash:pop` line on the Issue. A `restart` event follows its `child-launch`.
- It is not a recovery: the stop and the dispatch fall inside `lane:await`'s 15 s re-confirm window, so `run:merge` never classifies the child — nothing is parked, and neither the failure count nor `CONSECUTIVE_OUTAGE_LIMIT` moves.

**Output / exit codes:** the fresh child's pid on stdout, exit 0. No lane, no running child or a refused marker: child untouched, exit 1. Work that cannot be stashed, or a failed dispatch, leaves the stopped child for `run:merge` and exits 1.

### `josh lane:withdraw`

<!-- usage: lane:withdraw -->

Stop a running lane child, stash its uncommitted work and close the lane, leaving its issue open for the next run — booked withdrawn, not as an outage or a failure.

```bash
pnpm josh lane:withdraw 3769 --reason "folded into a broader issue"
```

<!-- /usage -->

- In order: records a `withdraw` event, stops the child's process tree, stashes the lane's uncommitted work as `<N>: uncommitted work at lane withdraw`, comments on the Issue that it stays open with a `- Why: <reason>` line, comments the `stash:pop` line, removes the `in-progress` marker and closes the lane. A child that had already ended is still withdrawn.
- A closed issue's lane is withdrawn by `run:wake`, or by `run:merge` when it closed without a merge.
- `run:merge` also closes the lane of a child whose `lane:plan` yielded (`josh lane:plan` in `docs/josh-commands-run.md`), booked `yielded`, not `withdrawn`; that issue stays in the run and is offered again once the holding lane ends.
- The Issue stays open, its state reason unchanged: the withdrawal ends this run's attempt, not the work. This run's `backlog:next` / `backlog:offer` exclude it (read off the `withdraw` event); a later run offers it again.
- The event comes first: `run:merge` and `run:board` book the child `withdrawn` from the stream before reading GitHub, so it is never resumed as an outage, parked `needs-decision` or counted as a failure, and the run moves on.

**Output / exit codes:** every explanation on stderr; exit 0 once the withdrawal finished. No open lane or an unreadable state: nothing written, exit 1. Work that cannot be stashed leaves the lane in place, exit 1.

### `josh lane:pause` / `josh lane:resume`

<!-- usage: lane:pause -->

Suspend a running lane child’s process tree (SIGSTOP) in place, leaving its work tree, branch and issue untouched, and record the pause in the lane’s state and the run’s event stream.

```bash
pnpm josh lane:pause 4198
pnpm josh lane:pause --all   # every open lane
```

<!-- /usage -->

<!-- usage: lane:resume -->

Let a paused lane child carry on from where it stopped (SIGCONT).

```bash
pnpm josh lane:resume 4198
pnpm josh lane:resume --all   # every open lane
```

<!-- /usage -->

- Signals the tree `lane:close` would end; a pause re-reads it until no new process appears. Work tree, branch and Issue are untouched; the child keeps its memory.
- A lane with a process signalled has its state record set to `paused` / `running` and gets one `lane-state` line on the run's event stream (`#<N> paused by lane:pause`), so who halted it and when is on record, and one `lane-state` line on the lane ledger, so `lane:stats` leaves the stopped time out of the lane's implement sub-stages.
- The lane's processes are its child's tree plus every process still running from the lane (working directory under its checkout, or the lane's `JOSH_LANE_CHILD` mark inherited in its environment, application bundles excepted; macOS), the caller's own ancestry spared.
- A detached `eslint_d` or `ship --detach` re-parented to pid 1 is among them. A pause stops them all, so a resume continues what it stopped.
- `lane:close` ends the same set and prints how many it ended: SIGTERM, then SIGKILL. A process alive after both leaves the close `incomplete`, with no `ended` record. `lane:withdraw` and `lane:restart` end it too.
- The supervisor retries such a close on every pass; `run:board` marks its leftover row `↻` (being ended) or `⚠ <reason> (pid <pid>)`.
- `run:board` draws a lane whose live processes are all stopped (also a hand-sent `kill -STOP`) as `🧊 paused`, its time frozen when first seen.
- Each lane has one state record, `josh-lane-state-<key>-<N>.json` in `<common git dir>/josh/run-state/`, keyed on the common git directory like the carry record (`JOSH_TEMP_ROOT` moves it), so it survives a reboot.
- The record holds the Issue, the run that launched it (the carry's start and owner), the state (`open` / `running` / `paused` / `ended`), the last launch time, and when and by which command the state last changed. It outlives `lane:close`.
- Only the lane commands write it: `lane:open` and `lane:adopt` (`open`), `lane:dispatch` / `lane:launch` / `lane:restart` (`running`, a launch), `lane:pause` / `lane:resume`, `lane:withdraw` / `lane:close` and `run:merge` (`ended`). The write is atomic; a transition the lifecycle lacks (an `ended` lane paused) is warned about and not written, and a failed write never fails the command.
- A lane with no record is never guessed at from its processes: it is counted in use, its state unknown. `lane:adopt` gives it a record again.

**Output / exit codes:** one line per lane (`paused N process(es)`), exit 0. A named lane with nothing to signal, or bad arguments, exit 1; under `--all` an idle lane is no failure.

### `josh lane:adopt`

<!-- usage: lane:adopt -->

Give an open lane that lost its state record a record again, read from its process, work tree, unpushed commits, pull request and issue — its work untouched.

```bash
pnpm josh lane:adopt 4744
pnpm josh lane:adopt --all   # every open lane with no record
```

<!-- /usage -->

- For a lane whose record was lost (a restart, a usage limit, an interrupted run). Its branch, work tree, stash and pull request are never touched.
- A lane is recorded `open` only when every fact reads: its process probe answers that no child is there, and its work tree status, unpushed commits, pull request and issue all read. Any one unread leaves it unknown, counted in use as before. A lane with a record is left as it is.
- The pull request is the branch's open one, else its newest, printed with its state — a reopened lane's branch can still carry the merged one.
- `open`, not `paused`: nobody suspended it. The next launch moves it to `running`, and the next `backlogrun` takes the lane back while its issue still carries `in-progress`.
- It holds its port seat while its child or listeners remain; a stopped tree alone holds no seat.
- An adoption adds one `note` line to the run's event stream (`#<N> adopted by lane:adopt`) — not a `lane-state` line, which would re-send the paused-lanes notice though no paused lane changed.

**Output / exit codes:** one line per lane — `recorded open — branch <b> · uncommitted changes · <n> unpushed commit(s) · PR #<n> <OPEN|MERGED|CLOSED> · issue OPEN (<labels>)`, `already recorded <state>`, or `left unknown — <reason>`. Exit 0, also for a lane already recorded. A named lane left unknown, no open lane for it, or bad arguments, exit 1; under `--all` a lane left unknown is no failure.

### `josh rule:value`

<!-- usage: rule:value -->

Print each delivered rule's unaided compliance — runs reached, kept rate, refusals.

```bash
pnpm josh rule:value             # a reading cached under 15 minutes ago, else measure
pnpm josh rule:value --fresh     # measure now, whatever the cache holds
pnpm josh rule:value --refresh   # write the reading to the loop-head cache instead of stdout
```

<!-- /usage -->

The kept rate is the share kept before the rule's trigger fired (`scripts/rules/rule-value.ts`).

- A lane's transcript counts with the parent run that dispatched it.
- It reports and never fails: an environment with no measurable transcript prints `no measurement targets` and exits zero.
- Printed from a cache at the `backlogrun` loop head (`josh backlog:offer`), refreshed at most every 15 minutes.
- Bare, it prints that cache while under 15 minutes old, then `cached reading taken at <ISO time>`. A lane reads its parent's cache.
- On stdout only, a `candidates:` section follows the table: `retire` lists measurable rules no run reached once the reading covers `MIN_RUNS_FOR_RETIREMENT` runs, and `condense` lists rules a hook refuses on every occurrence that it has refused (`scripts/rules/rule-value-candidates.ts`). The cache keeps the table alone, so `--fresh` prints them.

Detail: `docs/maintainers/josh-commands-rationale.md` → "`josh rule:value` in detail".
