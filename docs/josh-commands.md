# josh CLI — Command Reference

See also: [Command Catalog](josh-command-catalog.md) — auto-generated from the command map (command name, aliases, synopsis, audience, side effects).

`josh` is available as `pnpm josh` (or `pnpm exec josh`) after running `josh init`. Run `pnpm josh help` to print a grouped summary in the terminal.

## How a command runs

Most commands are a TypeScript file under `scripts/`; the rest are a shell line the dispatcher spawns. In kit's own checkout the dispatcher evaluates a script command in its own process rather than starting a second TypeScript runtime for it. Three conditions decide whether a command takes that route:

- **The dispatcher must run from TypeScript source** — kit's own `pnpm josh`. A consumer's `josh` bin is the bundled `dist/josh.js` under plain node, so every consumer keeps the spawning path.
- **The command must not need node flags of its own.** `doctor`, `latest:scope`, `followup` and `notify` pass `--env-file`, so they keep a process of their own.
- **A shell command has no script to import** and is spawned as before.

A new josh script keeps the canonical main guard `process.argv[1] === fileURLToPath(import.meta.url)`, or none at all. `scripts/josh/josh-in-process.test.ts` asserts the shape for every command that takes this route.

## Development

These commands replace the corresponding `package.json` scripts; consumer projects need not add them manually.

### `josh gate`

Run the completion gate's four checks — lint, type check, spell check and unit tests — **concurrently**, running all to completion and reporting every failure in one pass.

```bash
pnpm josh gate
pnpm josh gate --verbose   # every check's output, passing ones included
pnpm josh gate --force     # re-run even on a tree already recorded green
pnpm josh gate --no-unit   # the three static checks only (CI only)
```

- Static checks: `pnpm josh lint`, `pnpm josh cspell:dot`, `pnpm josh test:unit`; the type check resolves to a toolkit `check:ci` / `check` when installed, else `pnpm josh check`.
- A tree recorded green is reused unless `--force` or the changed-file map moved.
- **Refuses to start when the scoped pair has not been green on this tree.** A unit-included local gate reads the same record `josh review:brief` does and refuses — naming `pnpm josh lint:related && pnpm josh test:related` — so the first gate is the only gate. It never fires for `--no-unit` (CI has no scoped check in front of it) or `--force`, and `JOSH_SCOPED_GREEN=0` turns it off.
- **On failure, a line per failed check with the command to re-run is printed at the tail**, just above the verdict, so a `tail` of the output keeps every failure and its next action rather than one at a time.
- Exit `1` if any check failed. Refuses any argument other than the three flags.
- The unit leg is the long pole; [`josh test:unit`](#josh-testunit) runs it as a two-project split — same files, less wall clock, not fewer tests.
- **Each check claims a place in a machine-wide weighted core budget before it starts, and waits while the budget is full** (`scripts/gate/core-budget.ts`, joshuafolkken/kit#2351). The weights are the same measured table the plan already uses — the static checks' reserved cores and the unit suite's worker cap — so a lone gate's four claims sum to exactly the core count and every one is admitted at once: **a solo run's concurrency and worker count are unchanged**. Under concurrency the machine-wide sum is what bounds admission, so overlapping gates can no longer each reserve the whole machine, and the "whoever started first took everything" asymmetry is gone — a later gate waits rather than shrinking everyone. A leaked place is swept on read by the same pid-and-start-time liveness the unit-run marker uses, and a reservation that never fits is admitted at minimum width after a wait cap. A gate nested inside another gate's unit suite (this repository's own gate tests) takes no place, so it never waits on cores the outer gate is holding. The pre-push `pnpm install` and `pnpm josh audit` join the same budget through [`josh reserved-run`](#josh-reserved-run).

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

### `josh refactor:scan`

Compute the refactoring candidates `prompts/refactoring.md` §4.1–§4.3 describes, run as a command: it picks the target files (branch diff plus untracked, or `scripts/`; excluding `demo`, `src/routes/stories`, `/* @refactor-ignore */`), expands the scope along the import graph, asks the project's own eslint for the §4.2 categories, and answers `verdict: clear` / `verdict: candidates`. Reports and never fails.

```bash
pnpm josh refactor:scan
```

### `josh bytes`

Print how many bytes an agent-read document has against its recorded byte ceiling and how many remain — the byte counterpart of `josh lines`, so a mandated documentation update that would cross the ceiling is seen right after the edit rather than at the gate.

```bash
pnpm josh bytes docs/josh-commands.md           # one document
pnpm josh bytes                                 # scan: every budgeted document near its ceiling
```

```
docs/josh-commands.md  111777/114688 bytes · 2911 left
entry fullrun  227672/229376 bytes · 1704 left
```

- The scan closes with one row per workflow entry — the **primary** budget (`entry-read-budget.ts`), the total each entry reads against its ceiling — so the main budget is no longer a number the gate reveals only when it fails (joshuafolkken/kit#2271). The per-document rows above them are the fallback budget, covering the documents no entry reads.
- Path is repository-root-relative (a leading `./` is stripped); a path with no budget entry reads `not counted`.
- The recorded ceiling is block-quantized — the next 4 KB multiple at or above the document's size (`document-byte-budget.ts`, joshuafolkken/kit#2231), so a document growing within its block needs no ceiling edit and parallel command-adding lanes stop conflicting on this record. An over-budget row names the value to record: the next block multiple, not the raw current size. Never fails — the ceiling is the gate's and `josh lint:related`'s to enforce; a non-zero exit means the argument list was unusable.

### `josh format`

Format code with prettier and eslint.

```bash
pnpm josh format
```

### `josh format:edited`

Format the single file an agent just edited. Not run by hand: `.claude/settings.json` wires it to `PostToolUse` and pipes the tool call as JSON on stdin; it reads `tool_input.file_path` and runs `eslint --fix` then `prettier --write` on that path alone.

```json
"PostToolUse": [
	{
		"matcher": "Edit|Write|Bash",
		"hooks": [{ "type": "command", "command": "pnpm josh format:edited", "timeout": 90 }]
	}
]
```

- eslint runs first (warm `eslint_d`, cache `.eslintcache.edit`), prettier last. Never fails; skips `node_modules` / `.git` at any depth, `dist` / `build` at top level.
- Carries a density line via `hookSpecificOutput.additionalContext` under set conditions.
- **Reports the problems `eslint --fix` could not fix** on the same `additionalContext`, lifted from the `--fix` pass's own stdout (no extra process) — file, `line:col` and rule name, so they are seen on the edit rather than deferred to the gate. What eslint fixed is applied silently; a file that runs prettier alone (`.md` / `.yml`) reports nothing. The block is cut to a bounded length and marked when a lint dump would be large. It never sets `permissionDecision`, so the edit is not turned into a failure.

### `josh batch:guard`

Refuse a tool call that would make a third consecutive single-call turn, pushing the run toward batching independent calls. Wired to `PreToolUse` via `.claude/settings.json`, fed the pending call as JSON on stdin.

```json
"PreToolUse": [
	{
		"matcher": "Bash|Edit|Read|Write",
		"hooks": [{ "type": "command", "command": "pnpm josh batch:guard", "timeout": 20 }]
	}
]
```

- `Bash`, `Edit`, `Read` are refusable; `Write` earns only a non-blocking notice. Refused only when two single-call turns are closed behind it, the call is bundleable, and it touches nothing the sequence already touched.
- **A notice, not a refusal, in a dispatched lane child** (`JOSH_LANE_CHILD`): a _refusal_ ends a headless child's turn (joshuafolkken/kit#2138), so the guard downgrades to a non-blocking notice — the call proceeds with the guidance attached. kit#2178 took kit#2164's notice `off` after it did not move the density; with it `off` it fired **zero** times across the 2026-09-21 backlogrun measured next, so the 1.147 read there is the rate with no guidance. kit#2276 re-enables it with the two things #2164's lacked — it **names the concrete recent calls** and **recurs every single-call turn** — to be re-measured, redesigned rather than kept if it misses the target. Decided from the one-place enumeration in `scripts/lane/lane-guard-policy.ts` — `refuse` / `notice` / `off`.
- **Fires more than once per run.** The first firing lands when a run of single-call turns reaches the limit; if the run keeps single-calling it fires again — the **refusal** every `REFIRE_EVERY` further turns (the initial limit), the **notice** every `NOTICE_REFIRE_EVERY` (joshuafolkken/kit#2276, tighter, since a notice cannot wedge a run). Both are single constants in `time-batch-guard.ts`. A call re-issued unchanged after a firing is let through, and a batched turn starts a fresh sequence — replacing the old one-firing-per-run behavior that fell silent for the rest of a run that ignored it.
- Set `JOSH_BATCH_GUARD` to `off` / `0` / `false` / `no` to disable.

### `josh investigation:guard`

Refuse a file read once the run has read the threshold's worth of un-edited files since its last delegated unit, pushing bulk investigation into a delegated unit. Wired to `PreToolUse`, fed the pending call as JSON on stdin.

```json
"PreToolUse": [
	{
		"matcher": "Read|Bash",
		"hooks": [{ "type": "command", "command": "pnpm josh investigation:guard", "timeout": 20 }]
	}
]
```

- On the `Bash` side only read-only lines are refused (`bat`, `cat`, `head`, `less`, `more`, `nl`, `sed`, `tail`); a delegation clears the pending set. Excludes the run's own instructions (`CLAUDE.md`, `prompts/`, `.claude/skills/`) and harness session files.
- **Suppressed in a dispatched lane child** (`JOSH_LANE_CHILD`), because the child is itself the delegated unit the refusal asks for and cannot dispatch a sub-unit to read its own edit targets — decided from the one-place enumeration in `scripts/lane/lane-guard-policy.ts` (joshuafolkken/kit#2138).
- Set `JOSH_INVESTIGATION_GUARD` to `off` / `0` / `false` / `no` to disable.

### `josh duplicate-read:guard`

Refuse the second whole-file `Read` of a path whose content has not changed since the run last read it (joshuafolkken/kit#2298) — the re-read returns text the run already holds, and across the latest five lanes a run re-read the same unchanged path 8.0 times on average. It runs inside `pretool:guard` (composed alongside `batch:guard`, `investigation:guard` and `rule:guard`), not as a separate `PreToolUse` entry.

- The transcript gives the instant the path was last read; the filesystem's `mtime` says whether it has changed since. A file whose `mtime` predates that read is refused; one that has been edited, merged or grown by a background task — anything that moves the `mtime` — is let through.
- A read carrying an `offset` or `limit` reads a different region, so it is never refused. A stat that fails (a deleted or unreadable file) allows the call — the fallback is allow, never refuse.
- One refusal per accumulation: a run refused once and reading on anyway is not refused again, and the refusal re-arms when a fresh successful read of the target lands after it — the same shape as `investigation:guard`.
- **In a dispatched lane child it is a `notice`, not a refusal** (`JOSH_LANE_CHILD`), because a denial ends a headless turn — and the duplicates are measured in those children, so silencing it there would neuter it where the count lives. See the `pretool:guard` lane-child enumeration below.
- Set `JOSH_DUPLICATE_READ_GUARD` to `off` / `0` / `false` / `no` to disable.

### `josh rule:guard`

Deliver a rule at the tool call that binds it, instead of carrying it resident in `CLAUDE.md` every turn. Wired to `PreToolUse` (on `Bash` alone), fed the pending call as JSON on stdin.

```json
"PreToolUse": [
	{
		"matcher": "Bash",
		"hooks": [{ "type": "command", "command": "pnpm josh rule:guard", "timeout": 20 }]
	}
]
```

`scripts/rules/delivered-rules.ts` holds one row per relocated rule — an id, the trigger, and the refusal text.

**The rules it delivers today:**

- **Backlog WIP cap** — trigger is a `Bash` call that files an Issue (`gh issue create`, or a `title`-bearing POST to a path ending `/issues`).
- **Issue comments** — trigger reads an Issue body without them (`gh issue view <N>`, or a `GET` ending `…/issues/<N>`); hands over `gh issue view <N> --comments`.
- **Piped verification** — trigger is a josh check (`gate`, `check`, `lint*`, `cspell*`, `test*`, `eval`, `overrides`, `ranges`) standing anywhere but the last pipeline segment.
- **Early heartbeat** — trigger is a `Bash` call whose whole purpose is to wait; `pnpm josh run:progress --once` / `--wait` are exempt.
- **The pre-gate cut row**: the trigger is a `Bash` call that runs `pnpm josh gate` from a **lane** working tree that **has not yet taken its cut**, handing over `pnpm josh run:cut <N>` with what each of its six verdicts obliges. It exists because the step was carried as prose and fired **0 times in 6 lane children**; `--resume`, `--end` and `--json` do not count as taking the cut. `.claude/skills/workflow-commands/pre-gate-cut.md` is the single source of the procedure.
- **Bare `pnpm josh git`** — trigger is a `pnpm josh git` with no `-y` / `--yes` (joshuafolkken/kit#2297); it prompts to confirm the staging, cancels with no TTY, and the run reissues with `-y` after throwing the time away. Hands over `pnpm josh git -y "<title> #<N>"`. Disjoint from the run-tail push row by the flag — that one requires `-y`, this refuses its absence — and it fires on every occurrence.

Set `JOSH_RULE_GUARD` to `off` / `0` / `false` / `no` to disable. One delivery per run.

### `josh pretool:guard`

The `PreToolUse` dispatcher that routes each pending tool call to the delivered-rule guards (`batch:guard`, `investigation:guard`, `duplicate-read:guard`, `rule:guard`). A refusal leaves through `hookSpecificOutput.permissionDecision`; an unclaimed call writes nothing.

**How each of the four behaves in a dispatched lane child is an enumeration, not a judgement** (joshuafolkken/kit#2138, joshuafolkken/kit#2164, joshuafolkken/kit#2178, joshuafolkken/kit#2276, joshuafolkken/kit#2298). A denial is guidance to an interactive main line but a fatal turn-ender to a headless `claude -p` child, so `scripts/lane/lane-guard-policy.ts` lists, in one place, each guard's three-valued mode for a lane child (`JOSH_LANE_CHILD`) — `refuse`, `notice`, or `off`: `investigation` is `off` (its remedy is a delegated read the child cannot dispatch), `batching` is `notice` (kit#2178 took kit#2164's notice `off` after it did not move the density; kit#2276 restores it naming the concrete recent calls and recurring every single-call turn), `duplicate-read` is `notice` (a refusal would kill the child, and the unchanged re-reads it catches are measured in those very children — so it nudges rather than silences, kit#2298), while `rule` stays `refuse` — it carries the lane-only rules a child depends on (`pre-gate-cut`, `lane-park`) and the safety rules it must still obey. `lane-guard-policy.test.ts` pins that the enumeration and the guards' live behavior cannot disagree.

### `josh stop:guard`

The `Stop` hook (joshuafolkken/kit#2121, joshuafolkken/kit#2247): one process delivering the three stop-time rules — stop-notification, hold-release and issue-citation all **block** the stop, since `{"decision":"block"}` is a `Stop` hook's one channel to the model. A bare `#N` in the reply's prose is fed back so the model reissues the reply with a number-link; the detection skips a `#N` inside a fenced code block, inline code, a quote line, or right after `PR` / `pull request`. Built on `hook-decision.ts`, `lane-park.ts` and `run:hold`; fails open, and `stop_hook_active` breaks a block loop. The rows are in `prompts/collaboration-workflow/rule-delivery.md`.

### `josh session:lang`

Print the language this session writes in, resolved from `JOSH_SESSION_LANG`. Wired to `UserPromptSubmit` so the value is injected every turn.

```json
{ "type": "command", "command": "pnpm josh session:lang", "timeout": 10 }
```

- Read via `process.loadEnvFile` (environment wins). Unset / empty / no-`.env` resolve to `ja`; `JOSH_SESSION_LANG=en` opts into English.

### `josh cspell:dot`

Run spell check, including dotfiles.

```bash
pnpm josh cspell:dot      # includes dotfiles
```

- Runs with `--no-progress`, so it prints only the unknown-word lines and the summary — not the per-file `N/1607 <path> cached` progress that once filled the whole output past the tool's truncation cap (joshuafolkken/kit#2296).

### `josh behavior`

Check the current run's recorded transcript against the behavior assertions and report where any broke — with **no live Claude session and no model call** (joshuafolkken/kit#2365). It is one of `pnpm josh gate`'s checks, so behavior regressions are caught every run rather than only by eye.

```bash
pnpm josh behavior
```

- **The data is what every run already writes.** Claude Code files each session's transcript under `~/.claude/projects/**/*.jsonl`; an assertion read off a recorded transcript is deterministic, re-runnable and never calls a model — which is exactly what joshuafolkken/kit#1922 removed the slow five-live-session `josh eval` path for lacking.
- **The scope is the current run, not the whole corpus.** The store holds thousands of transcripts and over a gigabyte; walking all of it every gate would cost minutes. Each gate checks its own run — the newest session transcript, resolved exactly as `josh cost` resolves "the run that just finished" — so across runs the whole corpus is covered a run at a time. The engine stays general, so a broad scan of past runs (how a new assertion is verified green before it is added) is the same walk over a different set of files.
- **A run with no transcript passes** without the skip marker, so a CI runner — which has none — never withholds the gate's green record.
- **The seed set is one assertion**, green across the recorded corpus today: `no-direct-git-index-mutation` — `git add` / `git commit` / `git rm --cached` / `git restore --staged` must go through `pnpm josh git` (dry runs excluded). New assertions are added one at a time, each verified green against past real runs first. A break prints which run and which point it broke at.
- **The manual `josh eval` is untouched**: this restores behavior verification without reviving the live-session path it removed.

### `josh test:unit`

Run unit tests with vitest. **Skips gracefully (exit 0)** when `vitest` is not installed. Once `vitest` and at least one test file are present, runs `vitest run`.

```bash
pnpm josh test:unit
```

- `vitest` installed with **no** `*.{test,spec}.{ts,js}` file anywhere is a failure, not a skip.
- Guards (kit's own checkout): a unit test that reaches the network or writes into the suite's repository fails; the fix is in the test (mock the read, clear git location env, carry identity on `-c`).
- **The suite runs as two Vitest projects** (`vitest.config.ts`): the classifier's isolation-free files (`scripts/test/pilot-files.ts`) run `pure` with `isolate:false` — each shared module evaluated once per worker, not once per file, a measured 57% cut on that set (joshuafolkken/kit#2170) — and the rest run `isolated` with the default. They partition the suite exactly, so **the same files run and the green condition is unchanged**; only the pure ones run faster. The state guard is scoped to `pure`.
- **A setup file silences the real streams for each test body** (`scripts/test/test-stdout-guard.ts`), so a fixture that drives a CLI `main` cannot leak its `process.stdout` lines into the suite's output; `console.*` is untouched and the streams are restored after each test (joshuafolkken/kit#2296).

### `josh test:related`

Run only the unit tests related to the files the change touched — the unit check an implementation loop repeats between edits. Added in front of the whole `josh test:unit`, never in place of it.

```bash
pnpm josh test:related
pnpm josh test:related scripts/thing.ts    # narrow by the given files instead
pnpm josh test:related --silent            # flags are forwarded to vitest
```

- Changed set handed to `vitest related`; value-taking flags must be `--flag=value`. Falls back to the whole suite (naming which case) when no changed file is importable; a narrowed run matching nothing prints `No test files found` and exits 0.

### `josh test:declared`

Report whether the working-tree change needs a test — `required`, `exempt`, or `satisfied` — from changed paths alone; the same verdict refuses `pnpm josh git -y` on `required` (`prompts/collaboration-workflow/rule-delivery.md`). On `required` the detail names each untested file's type — `E2E` under `src/routes/`, `Unit` elsewhere (`prompts/testing-guide.md` §1) — and then the one command to run next: declare a test for each and verify with `pnpm josh test:declared --match < summary.md` (joshuafolkken/kit#2297).

```bash
pnpm josh test:declared
pnpm josh test:declared --match   # check Step 0 declarations on stdin
pnpm josh test:declared --help    # print usage, including the --match stdin form
```

An unknown flag is refused with the usage rather than ignored (joshuafolkken/kit#2297), the same convention `josh time` follows.

`--match` checks each `Test: <type> — <path>` declaration on stdin against the change set, printing `match` / `type-mismatch` / `path-missing` / `test-not-created` per line and exiting non-zero on any mismatch.

### `josh test:e2e`

Run E2E tests with Playwright. **Skips gracefully (exit 0)** when `@playwright/test` is not installed or no `*.e2e.{ts,js}` files exist. Once both are present, runs `playwright test`.

```bash
pnpm josh test:e2e
```

### `josh e2e:retry-check`

Report whether the preview server process died during a failed E2E attempt. Invoked by the distributed `ci.yml` between the two attempts of its E2E job.

```bash
pnpm josh e2e:retry-check
```

- Reads the preview server debug log (`WRANGLER_LOG_PATH`, default `e2e-web-server-logs`) and matches only when `Error in ProxyController` **and** `Network connection lost.` are in the same file. Verdict written to `$GITHUB_OUTPUT` as `crashed`; a missing/unreadable log ends at "no crash".

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

Type-check a SvelteKit project. Requires `@sveltejs/kit`.

```bash
pnpm josh check        # development mode
pnpm josh check:ci     # strict mode (--threshold error), used in CI
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

### `josh init`

Initialize config files in a new project — creates or merges all managed config files, and reports two repository settings (Dependabot security updates, Allow auto-merge) that back the files it writes.

```bash
pnpm josh init   # create/merge config files
```

**Output / exit codes:** exits non-zero inside the distribution package's own repository, where it writes nothing.

See [init.md](./init.md) for the full file list and [`josh doctor`](#josh-doctor) for the settings reports.

### `josh sync`

Overwrite managed files with the latest versions from the package. Run after upgrading `@joshuafolkken/kit` to pull in updated AI files, workflow templates, and other managed files. Also realigns `devEngines.packageManager.version` with the `packageManager` pin so the two never drift.

```bash
pnpm josh sync   # overwrite managed files
```

**Output / exit codes:** exits non-zero inside the distribution package's own repository, where syncing would overwrite the source with its own derived templates.

See [sync.md](./sync.md) for the full file list.

### `josh sync:scope`

Report whether the current change touches a file `josh sync` distributes.

```bash
pnpm josh sync:scope           # the branch diff
pnpm josh sync:scope --staged  # the staged diff instead
pnpm josh sync:scope --json    # {"scope":"managed","reason":"..."}
```

**Options:**

- `--staged` — inspect the staged diff instead of the branch diff.
- `--json` — emit `{"scope","reason"}` as JSON.

**Output / exit codes:** the answer (`managed` or `clean`) goes to stdout, the reason to stderr. Exit status is `0` for both — this reports, it does not gate.

### `josh sonar:hotspots`

Fetch the SonarCloud hotspots on a pull request and print each one's Step B branch (`excluded` / `local` / `fix` / `defer`); a failed read prints `unreadable`, distinct from finding none. The project key comes from `sonar-project.properties` and the upstream-synced branch key from `sync:scope`'s own detection. Full handling: `prompts/sonar-hotspot-handling.md`.

```bash
pnpm josh sonar:hotspots 42
```

### `josh ui:routes`

List the screenshot-target routes the change touches: a changed `+page` / `+layout` gives its own route, a changed shared component the routes that import it (a one-level `src/routes` scan). Empty output prints "no route derived" rather than guessing; the `verify-ui` skill's §1 narrows the list.

```bash
pnpm josh ui:routes            # the branch diff
pnpm josh ui:routes --staged   # the staged diff instead
```

### `josh propagate`

Carry the release this repository just published into every consumer repository checked out next to it. Runs only from the supplier's own clean, up-to-date default branch; waits for the exact published version to appear in the registry before touching any consumer.

```bash
pnpm josh propagate
pnpm josh propagate --dry-run           # report targets and steps, write nothing
pnpm josh propagate --skip-publish-wait # release already known to be published
```

**Options:**

- `--dry-run` — report targets and steps without writing; skips the publish wait, opens no issues.
- `--skip-publish-wait` — skip the registry poll for an already-published release.

Per consumer, in order: working-tree check, `pnpm add -D @joshuafolkken/kit@<version>`, `pnpm josh sync`, verification gate, open upgrade issue, `pnpm josh git`, return to default branch. One consumer's failure never stops another; each is reported as `propagated`, `failed` (with the step, reason, and what it left behind), or `skipped`.

The opposite direction — one consumer catching itself up from its own checkout — is [`josh adopt`](#josh-adopt).

### `josh adopt`

Upgrade every `@joshuafolkken/*` toolkit installed in **this** repository to latest, sync each one's managed files, verify, and open the issue and pull request. The consumer-side counterpart of [`josh propagate`](#josh-propagate), sharing the same step order.

```bash
pnpm josh adopt
pnpm josh adopt --dry-run # report the steps without touching anything
```

**Options:**

- `--dry-run` — report the plan without writing.

Steps, in this repository's directory: working-tree check, `pnpm add -D <toolkit>@latest` (once per installed toolkit, base tier first), `pnpm josh sync` per toolkit's own CLI, verification gate ([`josh gate`](#josh-gate)), open issue, `pnpm josh git`, return to default branch.

**Output / exit codes:** exits `0` on a skip (no toolkit declared, or all current with no file changed). Refused inside kit's own repository, when a runnable toolkit is missing or declared under `dependencies`, or when `@joshuafolkken/kit` is not a direct dependency. Stops at the open pull request — merging is [`josh followup`](#josh-followup)'s job.

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

Related: [`josh followup`](#josh-followup), [`josh pr`](#josh-pr).

### `josh pr`

Create the pull request for the current issue branch — a recovery/standalone counterpart to `josh git` for when the branch is already committed and pushed. It derives the issue number and title from the branch name (`<N>-<slug>`) and generates the `closes #N` line.

```bash
pnpm josh pr   # open the PR for the current <N>-<slug> branch
```

**Behavior:** reports an existing open PR for the branch instead of opening a second one.

### `josh followup`

AI-assisted PR follow-up workflow: waits for CI, checks AI-reviewer findings, sends the completion notification, and merges.

```bash
pnpm josh followup "PR title #N"                                    # merges (default)
pnpm josh followup "PR title #N" --notify-message "Implemented X:\n- change 1"
pnpm josh followup "PR title #N" --notify-message-file completion.md
pnpm josh followup "PR title #N" --ai-review-ignore-reason "false positive"
pnpm josh followup "PR title #N" --no-merge                         # do the work, leave the PR open
```

**Options:**

- `--no-merge` — do the follow-up work but do not merge; leaves the PR open (the only flag that stops the merge). `--merge` is a deprecated no-op.
- `--notify-message` — inline completion body; `\n` expands to newlines.
- `--notify-message-file` — read the completion body from a file (`-` reads stdin); use this whenever the body carries a backtick or `$`. Passing both forms is refused.
- `--ai-review-ignore-reason` — reason to dismiss an AI-review finding.

**Behavior:** merging is the default. The CI wait polls every 10 s with a 32-minute budget (`JOSH_CI_TIMEOUT_SECONDS` overrides); any non-success conclusion ends it immediately naming the failure, and a merge conflict (`DIRTY`) ends it on the first poll. CodeRabbit is exempt from the wait, and a skipped check is noted in the completion Telegram. On a merged run only, it closes any completed epic (now cascading up nested epics, so a completed parent closes too), removes `in-progress`, flushes the observation ledger, ends the progress watcher, and lists up to five next-run candidate issues. Give the tool call its longest timeout — the wait can outlast a single call and `&` backgrounding does not survive.

**Output / exit codes:** exits non-zero naming the failing check on a red run; prints a per-stage timing block (`followup stage: <name> <n> s`) on both success and failure.

Related: [`josh git`](#josh-git), [`josh observations:flush`](#josh-observationsflush), [`josh time`](#josh-time).

### `josh notify`

Send a Telegram notification for planning, confirmation, failure, warning, and kickoff-retry alerts.

```bash
pnpm josh notify --task-type planning --issue-url "https://..." --body="- bullet 1\n- bullet 2"
pnpm josh notify --task-type confirmation --issue-url "https://..." --body="Waiting for approval"
pnpm josh notify --task-type failure --issue-url "https://..." --body="Build failed"
pnpm josh notify --task-type confirmation --issue-url "https://..." --body-file reason.md
```

**Options:**

- `--task-type` — one of `planning` 📋, `completion` ✅, `failure` ❌, `warning` ⚠️, `kickoff_retry` 🔄, `confirmation` ⏸️. Do not send `completion` or `warning` by hand — `josh followup` sends them.
- `--body` / `--body=$'…'` — inline body; use `--body=$'…'` when it starts with `-`.
- `--body-file` — read the body from a file (`-` reads stdin); use whenever the body carries a backtick or `$`. Passing both body forms is refused.
- `--repo-name` / `--issue-url` / `--pr-url` — header repository, resolved in that order, then the working directory. The issue title is read from `--issue-url`.

**Output / exit codes:** a send that reached nobody exits non-zero, naming the missing variables or the HTTP status (never the token values). `.env` is read via `--env-file-if-exists`. Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

### `josh observations:flush`

Commit the observation ledger (`docs/observations.md`) as a docs-only pull request of its own (no `closes #N`), wait for the required checks, merge it, and return to the default branch. It is the ledger's only commit path — `josh git` excludes the ledger from staging.

```bash
pnpm josh observations:flush
```

**Behavior:** refuses off the default branch (naming `pnpm josh main:sync`) and refuses when the working tree holds any change besides the ledger (listing those paths). When the ledger matches the commit it sits on it prints `clean` and exits 0. A commit the pre-commit hook rejects is rolled back and its branch removed; a leftover flush branch that holds a commit is landed first, one holding none is discarded. `pnpm josh followup` runs this automatically after a merged run, so it is rarely typed by hand.

Related: [`josh followup`](#josh-followup).

### `josh measure:rerun`

Re-run a behavior-change Issue's declared baseline after it merges and print the before/after pair. It reads the `## ベースライン` section of a body file, runs each `` `<command>` → <value> `` entry, and prints the recorded value beside the re-measured one — the merge-time re-read a prose rule never gets (joshuafolkken/kit#2178).

```bash
pnpm josh measure:rerun /tmp/issue-body.md
```

**Behavior:** when a value has not moved, the premise the rule rested on is recorded as refuted — one line appended to the observation ledger (`docs/observations.md`), keyed to the command so a second refutation of the same measurement is a same-key repeat the promotion rule counts. It reuses that append-only ledger rather than a second one. A section written in prose (no `` `command` → value `` line) is refused, since a natural-language measurement cannot be re-run. `pnpm josh observations:flush` is the ledger's commit path.

Related: [`josh observations:flush`](#josh-observationsflush), [`josh issue:lint`](#josh-issuelint).

### `josh review:record`

Record a `/code-review` round's findings so they survive the run (joshuafolkken/kit#2325). It appends one `- rf:<category> | <severity> | <file> | <date> | #<issue>` line per finding to the observation ledger (`docs/observations.md`) — the same append-only file the observation lines use, under a distinct `- rf:` prefix so the `- k:` grammar never treats a finding as its own. It is the one write path for findings.

```bash
pnpm josh review:record --issue 2325 bug-risks:medium:src/foo.ts:42 tests:low:a.test.ts
pnpm josh review:record --issue 2325          # a zero-finding round — records one `none` line
pnpm josh review:record --check --issue 2325  # the merge gate: was it recorded?
```

**Behavior:** each positional is `<category>:<severity>:<file>`, split on its first two colons so a `:line` citation stays in the file field. The category must be one of the nine review-rubric categories and the severity one of `high` / `medium` / `low`, or the call is refused. A call with no findings writes a single `- rf:none | none | - | <date> | #<issue>` line, so a round that found nothing is recorded rather than mistaken for a round nobody reviewed. `pnpm josh observations:flush` commits the appended lines like any other ledger change.

**`--check --issue <N>` is the merge gate** [`josh followup`](#josh-followup) runs (joshuafolkken/kit#2343): a `- rf:` line for the issue is `ok`, its absence is `missing`, no ledger `not-required`.

Related: [`josh review:findings`](#josh-reviewfindings), [`josh observations:flush`](#josh-observationsflush).

### `josh review:findings`

Count the recorded review findings by category (joshuafolkken/kit#2325) — the reader over what `josh review:record` wrote. It reads the observation ledger, tallies each recurring category most-frequent-first, and prints the number of zero-finding rounds, which tells a genuinely quiet category apart from one nobody looked at.

```bash
pnpm josh review:findings
```

**Behavior:** counts only `- rf:` lines, ignoring the `- k:` observation lines in the same file. The `none` sentinel lines are excluded from the category tally and reported as the zero-finding round count instead. A ledger with no finding lines prints `no review findings recorded yet`.

Related: [`josh review:record`](#josh-reviewrecord).

### `josh main:sync`

Checkout the default branch and pull the latest changes with `git pull --ff-only` (the strategy is named by the command, not read from git config).

```bash
pnpm josh main:sync
```

**Behavior:** refuses inside a linked work tree (a lane) and exits non-zero — run it in the primary checkout instead; a lane's terminal step is `pnpm josh lane:close <issue-number>`. A default branch that has diverged fails loudly under `--ff-only` rather than growing a merge commit — the deliberate opposite of [`josh main:merge`](#josh-mainmerge). The same `--ff-only` pull is used by [`josh git`](#josh-git), `josh pr` and [`josh release`](#josh-release) when they start from the default branch.

### `josh main:merge`

Bring the repository's default branch into the branch this checkout is on: fetches `origin/<default>` and merges it into the current branch.

```bash
pnpm josh main:merge
```

**Behavior:** the merge strategy is named by the command rather than read from git config, so a diverged branch — the state the command exists for — merges cleanly instead of aborting with `fatal: Need to specify how to reconcile divergent branches`. Merging (not rebasing) avoids the force push the distributed `.claude/settings.json` denies. A conflicting merge leaves git's report on screen and exits non-zero; resolve it as any merge.

---

## Versioning

### `josh bump`

Bump the package version in `package.json`. Not part of the child flow — `josh release` raises the version instead.

```bash
pnpm josh bump major
pnpm josh bump minor
pnpm josh bump patch
```

After bumping, update `docs/` to reflect any behavior changes before committing.

### `josh release`

Release everything main has taken since the version last changed — one command, run by a person. It counts merges on main's first-parent line since the last version change, raises the version by that many minors, opens and merges a `release/v<version>` pull request, then polls for the `v<version>` tag.

```bash
pnpm josh release
pnpm josh release --dry-run   # count and report, write nothing
```

**Options:**

- `--dry-run` — count and report only; does not pull (a pull is a write).
- `JOSH_RELEASE_TAG_TIMEOUT_SECONDS` (env) — tag-watch budget, default 30 minutes.

**Output / exit codes:** exits 0 and writes nothing when the pending count is zero; exits non-zero if the working tree is dirty, the checkout is not on the default branch, no version base can be found, or the `v<version>` tag never appears.

### `josh release:scope`

Say whether a release is owed, so the moment one is cut is not a judgement. Reads the same fetch-then-count as `josh followup`, so the two never disagree.

```bash
pnpm josh release:scope          # → required | skip | unknown
pnpm josh release:scope --json   # {"scope":"…","reason":"…"} on one line
```

| It answers | When                                                             |
| ---------- | ---------------------------------------------------------------- |
| `required` | main has taken at least one merge since the version last changed |
| `skip`     | the count is zero                                                |
| `unknown`  | the count could not be read                                      |

**Output / exit codes:** the verdict goes to stdout, the reason to stderr. Exit code is 0 for every verdict and 1 only for an unknown flag; `unknown` is a verdict, never read as `skip`.

### `josh version`

Show the global-install version, the current project version, and the latest published version — plus the **running binary** (the install that actually executed, resolved from `import.meta.url`), the single source of truth for which `josh` produced the report. A not-installed target reports `not installed`; a stale one gets a `Run:` hint with the upgrade command. A release inside the `.npmrc` `minimum-release-age` window prints a `Held:` line. When the `josh` first on `PATH` is not the pnpm-global install, a PATH-shadowing warning names both paths and points to [`josh doctor --fix`](#josh-doctor).

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

`doctor` reports the running binary, the `josh` first on `PATH` (`which josh`), and the pnpm-global install (`pnpm bin -g`), warning when the two differ and printing the recovery command. In a kit consumer it also prints a **Consumer setup** section — one-line `✓` / `⚠` verdicts for the kit plugin, git `core.hooksPath`, `CLAUDE.md`, and secretlint — plus the repository's **Dependabot security updates** and **Allow auto-merge** settings (`enabled` / `disabled` / `could not be read`; auto-merge also `paused`). None of these ever fail the command, and `doctor` never changes a repository setting.

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

### `josh overrides`

Check that the dependency overrides have not drifted after a dependency update.

```bash
pnpm josh overrides           # verify overrides unchanged
pnpm josh overrides --save    # snapshot current merged overrides
```

Reads **both** locations — the `overrides:` block in `pnpm-workspace.yaml` and legacy `pnpm.overrides` in `package.json` — merging them (a workspace entry wins a key collision) and printing where they came from. An empty `pnpm.overrides` is never treated as "no overrides".

**Options:**

- `--save` — write the current merged overrides to `.overrides-snapshot.json` (gitignored); later runs compare against it and exit non-zero on any add, removal, or change.

### `josh audit`

Run a security audit against the lockfile.

```bash
pnpm josh audit
```

The scanner is looked up on `PATH` first, then in the `josh audit:provision` cache (`node_modules/.cache/josh-tools/`). With neither present the audit exits non-zero and prints how to get one — it is never skipped or weakened.

### `josh audit:provision`

Install the pinned `osv-scanner` when `josh audit` cannot find one. Wired to the `SessionStart` hook of the distributed `.claude/settings.json` so the pre-push audit has a scanner.

```bash
pnpm josh audit:provision           # no-op if a scanner is already present
pnpm josh audit:provision --force   # ignore backoff, allow a longer download
```

**Options:**

- `--force` — ignore the 6-hour failure backoff and allow a longer download window; the command to run after fixing a network problem.

**Output / exit codes:** the version is pinned and its SHA256 verified before install. Any failure (network, non-OK response, checksum mismatch, no published build) is reported and exits `0` — the missing scanner surfaces at the pre-push audit instead.

### `josh reconcile-templates`

Keep the distributed templates in sync with the root files they come from. **Copy pairs** are byte-for-byte copies regenerated automatically (`.gitignore` → `templates/gitignore`); **tripwire pairs** intentionally diverge and only force a conscious review via a recorded hash (`sonar-project.properties` → `templates/sonar-project.properties`).

```bash
pnpm josh reconcile-templates           # regenerate copy templates + record tripwire hashes
pnpm josh reconcile-templates --check    # verify templates are in sync; non-zero on drift
```

**Options:**

- `--check` — verify only; exits non-zero on drift. A pre-commit hook runs this when a tracked source or copy template is staged.

Tripwire hashes live in `.template-source-manifest.json` (kit-internal, not distributed).

### `josh latest`

Update pnpm via corepack, update all dependencies to latest, and run a security audit.

```bash
pnpm josh latest            # full update (corepack + update + audit)
pnpm josh latest:corepack   # update pnpm only
pnpm josh latest:update     # update dependencies only
pnpm josh latest:scope      # → required | skip — does this run have to update?
```

`josh latest` never lowers a version: a supply-chain age gate can make the registry report an older release as newest, so `latest:update` rolls the whole tree back rather than writing a silent downgrade. It reports the overrides verdict itself and separately fails the run if `pnpm-lock.yaml` no longer honours an unconditional override.

#### `josh latest:scope`

Prints `required` or `skip` on stdout (reason on stderr) — whether this checkout must update. Read the answer with `$(pnpm josh latest:scope)`; workflow commands ask it instead of updating unconditionally. No completion record answers `required` (fresh checkout, cleared temp dir, or a half-finished chain). The freshness window is **12 hours**, overridable via `JOSH_LATEST_MAX_AGE_HOURS`. The record is per-checkout, and `--record` is the write half used by the chain (prints nothing on stdout).

#### `josh latest:guard`

Fronts the `josh latest` chain and refuses inside a lane; a lane's per-root stamp always reads stale.

#### `josh latest:corepack`

Updates pnpm and pins `packageManager` to the newest release on the project's **current major** (from `packageManager`), staying within `devEngines`. It temporarily widens the exact `devEngines` pin so corepack's `devEngines` validation accepts a newer patch, then realigns `devEngines.packageManager.version` byte-for-byte (integrity suffix included) with the `packageManager` pin. If the registry can't answer, the pnpm bump is skipped with a notice and nothing is widened.

#### `josh latest:update`

Runs `pnpm update --latest`, skipping **held-back** and **overridden** packages (overrides read from both `pnpm-workspace.yaml` and `package.json`) — `typescript` is currently held at `6.x`. Skipped packages print as `⏭ Skipping held-back / overridden packages: …`. If any direct dependency would move down, it restores `package.json` and `pnpm-lock.yaml` to what it found and exits `0`.

---

## Git hooks

### `josh prevent-main-commit`

Blocks direct commits to `main`. Installed as a pre-commit hook by `josh init`.

### `josh check-commit-message`

Validates commit message format. Installed as a commit-msg hook by `josh init`.

### `josh secretlint-scan`

Runs [secretlint](https://github.com/secretlint/secretlint) over the staged paths passed as arguments. Wired into the pre-commit hook by `lefthook/base.yml` as `pnpm josh secretlint-scan {staged_files}`. When secretlint is installed the scan runs and its exit code is forwarded, so a detected secret blocks the commit; when it is not installed the wrapper prints a notice and exits `0`.

**Options:** always passes `--no-glob` so lefthook's literal paths (e.g. SvelteKit `(app)` / `[id]` directories) are not treated as glob patterns.

### `josh pre-push-unit`

Runs the unit suite for the pre-push hook, reusing the result when [`josh gate`](#josh-gate) already recorded that exact tree green. Wired in by `lefthook/base.yml` as the pre-push `test-unit` command. Reuse requires the gate's file map, base commit and non-empty record to match, plus an empty `git status --porcelain` so the pushed HEAD equals the verified tree; otherwise the whole suite runs. A project with no vitest prints a skip notice; one with vitest but no test file fails.

```bash
pnpm josh pre-push-unit
JOSH_PRE_PUSH_FORCE=1 git push             # run the suite even on a tree recorded green
```

**Output:** on reuse, prints that the tree is already green and nothing was re-run.

### `josh reserved-run`

Runs a command while holding a place in the machine-wide core budget ([`josh gate`](#josh-gate)'s ledger, `scripts/gate/core-budget.ts`, joshuafolkken/kit#2351). Wired in by `lefthook/base.yml` as the pre-push `setup` install and the `audit` command, so both count toward the same budget the gate's checks reserve from — eight lanes pushing around the same time no longer spike a machine the gate thought it had to itself.

```bash
pnpm josh reserved-run 2 -- pnpm install       # hold 2 cores while installing
pnpm josh reserved-run 1 -- pnpm josh audit    # hold 1 core while scanning
```

- `<weight> -- <command...>`: the cores to reserve, then the command to run while holding them. The weight is the caller's — a conservative reservation for these two, not a measurement.
- Claims a place before the command starts and waits while the budget is full, exactly as a gate check does; the place is released when the command exits, on success or failure, and its exit code is forwarded.
- A missing separator, a non-integer weight, or no command is a usage error (exit `1`) — a pre-push command that ran unguarded would be the bug this removes.

### `josh pre-commit-type-check`

Type-checks the whole project for the pre-commit hook, reusing the result when [`josh gate`](#josh-gate) already recorded that exact tree green. Wired in by `lefthook/base.yml` as the pre-commit `type-check` command; runs `pnpm exec tsc --noEmit` when it runs. Reuse requires the gate's file map, base commit and non-empty record to match, that every `git status --porcelain` entry be fully staged (so the committed index equals the verified tree), and that the gate's type-check step be `tsc --noEmit` (projects using a `josh-app` / `josh-game` `check:ci` shim always run the full check). Nothing is forwarded to `tsc`; an argument other than `--force` is refused.

```bash
pnpm josh pre-commit-type-check
JOSH_PRE_COMMIT_FORCE=1 git commit          # type-check even on a tree recorded green
```

**Output:** on reuse, prints that the tree is already green and nothing was re-run.

---

## AI tools

Helpers for AI-assisted development workflows.

### `josh issue:read`

Print each issue's title, state, body and every comment in one call, replacing separate `gh api` body and comments reads.

```bash
pnpm josh issue:read 1715
pnpm josh issue:read 1715 1567 1605          # several numbers, read concurrently
```

Attribute each block by its `issue:` line, never by position. A number that resolves to nothing prints `does not resolve`; a failed read prints `could not read`; non-zero exit if any number went unanswered. Any non-numeric token refuses the whole call.

### `josh issue:state`

Print each issue's state, labels and whether a run must stop on it, in the spelling the workflow documents compare against.

```bash
pnpm josh issue:state 42                                   # single-number shape
pnpm josh issue:state 42 43 44                             # each block headed by `issue:`
pnpm josh issue:state 42 43 --repo joshuafolkken/app-kit   # a child in another repo
```

**Options:**

- `--repo <owner/repo>` — read a child in another repository; applies to every number.

State is `OPEN` / `CLOSED` / `MERGED`. `human_review:` answers whether the issue carries `needs-human-review`, matched case-insensitively. A number that resolves to nothing prints `does not resolve`; a failed read prints `could not read`; non-zero exit if any went unanswered.

### `josh issue:scout`

Before an issue is filed, answer the two questions every filing asks: has this already been filed, and which epic does it belong to.

```bash
pnpm josh issue:scout "Stop the gate re-running after every edit"
pnpm josh issue:scout "<title>" --body "follows on from #1246"
```

**Options:**

- `--body "<text>"` — supply prose references (`#N`) so the epic half has a number to work from; without one it prints `Epic: not asked`.

The duplicate half scores titles by token overlap; a candidate needs ≥2 significant shared words and similarity ≥0.35. The epic half is [`josh epic:bundle`](#josh-epicbundle)'s decision, and does not replace it.

### `josh issue:fold`

Before a run files a **second** finding in one session, answer whether the findings fold into one issue or stay separate — the filing-time counterpart to the split assessment, reading its same two questions (separability, and whether the whole clearly exceeds one verification gate).

```bash
pnpm josh issue:fold "First finding" "Second finding"                 # fold | separate | no-fold-needed
pnpm josh issue:fold "a" "b" --not-separable                          # the pair is really one deliverable → fold
pnpm josh issue:fold "a" "b" --json                                   # the verdict and reason, machine-readable
```

**Options:**

- `--not-separable` — declare the judgement half: the findings are one deliverable, so they fold whatever their size.
- `--json` — print the verdict and reason as JSON.

The size half is [`josh split:assess`](#josh-splitassess)'s own verdict, called not recomputed — the counting and the guide are single-sourced there. `separate` needs both halves (separable **and** over the size guide); every other case folds, and a lone candidate answers `no-fold-needed` without measuring. **An unreadable diff measures as under the guide, so an unanswerable size folds** rather than tipping to `separate`. `pnpm josh rule:guard` delivers the fold gate at a run's second `gh api … issues` call, never the first.

### `josh issue:cite`

Print the paste-ready number-link citation line for each issue in one call, so the correct session-facing form — `[#<N>](https://github.com/<owner>/<repo>/issues/<N>) — <summary>` — costs one command rather than a title read per issue. The summary is the issue's own title, fetched; adapt it to the session language when it matters.

```bash
pnpm josh issue:cite 2220
pnpm josh issue:cite 2220 1758 1252                        # several numbers, read concurrently
pnpm josh issue:cite 45 --repo joshuafolkken/app-kit       # bare numbers in another repository
pnpm josh issue:cite joshuafolkken/app-kit#45 2220         # per-token owner/repo#N notation
```

**Options:**

- `--repo <owner/repo>` — the repository for every bare number; a token written `owner/repo#N` overrides it for itself.

Citation lines go to stdout so the block stays paste-ready; a number that resolves to nothing or a read that failed is named on stderr rather than dropped, and any failure sets a non-zero exit. Any non-numeric token refuses the whole call. The [`Stop` hook's citation notice](../prompts/collaboration-workflow/issue-citation.md) points at this command with the numbers it detected already filled in.

### `josh issue:comment`

Post one comment to an issue (a PR comment is an issue comment over REST) with the body passed by path, and print the comment URL. It is the write side the read commands lacked — before it, every park, decision record and plan comment fell to a raw `gh api … body=@<path>`, where `-f` / `--raw-field` sends the literal `@<path>` and `-F` / `--field` reads the file, one character apart and silent when wrong (joshuafolkken/kit#2304). One command removes the choice.

```bash
pnpm josh issue:comment 2304 --body-file /tmp/park.md   # the body from a file — no shell evaluates it
pnpm josh issue:comment 2304 --body "a short note"      # inline, for a body with no backticks or $
```

**Options:**

- `--body <text>` — the comment body, inline. Trimmed, with `\n` expanded to a newline.
- `--body-file <path>` — read the body from a file, or from stdin with `-`. The safe form the rule steers every caller toward.

The body travels through [`cli-body.ts`](../scripts/josh/cli-body.ts), shared with `notify` / `followup`, so no shell evaluates it; `--body` and `--body-file` at once is refused rather than ranked. `pnpm josh rule:guard` refuses the `-f body=@…` misfire before it runs (the `raw-field-body` row), so the literal `@<path>` cannot reach GitHub.

### `josh pkg:scout`

Before the Package-First tier decision, rank candidate packages by measured metrics so Tier A ("clearly best") and Tier B ("genuine toss-up") are read off the output rather than judged (joshuafolkken/kit#2216). It queries the npm registry and prints one line per candidate: npm score, weekly downloads, last publish, bundled-types mark, license and unpacked install size.

```bash
pnpm josh pkg:scout "date formatting" --size 5
```

`--size <n>` sets how many candidates to fetch and rank (default 10). The verdict reads the top two's relative lead `(top − second) / top`: `clear` when the leader is ahead by at least 15% (select it, Tier A), `close` when within it (ask the user, Tier B). A failed per-candidate read leaves that metric blank (`—`).

### `josh issue:lint`

Check an issue body written to a file against the template's four required headings — `## 背景`, `## 現象`, `## 期待結果`, `## 受け入れ条件` (the single source is `prompts/collaboration-workflow/issue-template.md`). It reads a path rather than stdin so a body can be linted before the `gh api … issues` call that files it.

```bash
pnpm josh issue:lint /tmp/issue-body.md
```

Prints `ok` (exit 0) when every heading is present, or each missing heading name (exit 1). A heading has to be a line of its own — one mentioned inside a sentence is not the section heading. The judgement half (is the prose specific enough?) is out of scope; this is the mechanical half alone (joshuafolkken/kit#2123).

A body declaring itself a behavior-change Issue with `- 種別: 振る舞い変更` is additionally held to three headings — `## 発火点`, `## ベースライン` and `## 再現` (joshuafolkken/kit#2212, joshuafolkken/kit#2353). The firing point is matched against the delivery table: a hook-deliverable tool (`Bash` / `Edit` / `Read` / `Write` / `AskUserQuestion`) passes, a real but undeliverable tool is a mismatch, and a non-tool name is off the table. The baseline must be `` `<command>` → <value> `` so it is re-runnable; prose is refused. The reproduction must be a backticked command and its actual output in a fenced block (` ``` ` or `~~~`); prose ("確認した") is refused for the same reason — a defect claimed from a reading rather than a reproduction is caught at filing. A code-only Issue is held to none of this. After merge, [`josh measure:rerun`](#josh-measurererun) re-runs the baseline.

### `josh issue:backlinks`

Classify an origin issue's upstream backlinks into one fixed word. The backlink headings (`## Origin` / `## Upstream issues` / `## Upstream candidate`, single-sourced in `prompts/collaboration-workflow/issue-template.md`) were fixed so a grep could find them; this is that grep. It reads issue N, then the bodies of every upstream it lists, and checks the pair points both ways.

```bash
pnpm josh issue:backlinks 2123
```

**Verdicts:** `ok` (exit 0) when `## Upstream issues` lists repository-qualified references and each listed upstream cites `## Origin` back — a body with only `## Upstream candidate` (nothing filed yet) also reads `ok`; `missing-upstream` when no backlink heading is present; `missing-origin` when a listed upstream does not point back; `wrong-heading` for a near-miss heading (`## Upstream`), a bare `#N` reference, or a checkbox reference. Anything but `ok` exits 1.

### `josh report:lint`

Check a two-layer work summary (`CLAUDE.md` Step 0, single-sourced in `prompts/collaboration-workflow/report-format.md`) on stdin against the half a machine can enforce: the labels are present, no overview line runs over its character ceiling, nothing wraps the summary in a code fence, and no file path or CLI flag leaks into the overview.

```bash
pnpm josh report:lint < summary.md
```

Prints `ok` (exit 0), or the violations one per line (exit 1). The judgement half — whether the overview names a concrete subject — is left to the writer, because a machine cannot answer it (joshuafolkken/kit#2123).

### `josh stash:pop`

Pop the stash whose message matches, and no other. The stash is a repository-wide stack every work tree shares, so a bare `git stash pop` — or a positional `stash@{n}` read before another lane pushed — takes whichever entry now sits on top; that is how one lane's parked work reached another's tree (joshuafolkken/kit#2050). This resolves the selector from the message immediately before the pop, targeting the entry itself rather than a position that moves.

```bash
pnpm josh stash:pop "backlogrun: parked #2028"
pnpm josh stash:pop "backlogrun: josh latest before lanes" --dir "$dir"   # into a lane's work tree
```

**Options:** `--dir <path>` applies the pop in that work tree (`git -C <path>`); without it the pop lands in the current checkout. The stack is shared, so it reads the same either way.

**Verdicts:** `popped` and `conflicted` (exit 0), `no-match` and `ambiguous` (exit 1). A pop that applies but leaves conflicts is `conflicted` — the stash is on the tree, resolve the conflicts and continue. A message matching no stash, or more than one, is refused rather than guessed at — pass a message that identifies exactly one entry.

### `josh epic`

Create the epic issue that tracks a batch of child issues from one split. Satisfies all four mechanical requirements (`epic` label, task-list child rows, machine-readable `Dependencies`, an `Execution` run command) by construction.

```bash
pnpm josh epic "Epic: split the parser work" 101 102 103
pnpm josh epic "Epic: staged rollout" 101 102 --ordered
pnpm josh epic "Epic: ..." 101 102 --rationale-file rationale.md
```

**Options:**

- `--ordered` — argument order is the dependency order; writes the arrow chain, records the matching `blocked-by` relations, and adds a `### Declared order` entry under `## Decisions`.
- `--rationale-file <path|->` — split rationale prose (`-` reads stdin).
- `--origin <owner/repo#N>` — backlink when the split originated in another repository.

The `Execution` section prints `backlogrun #<E> --only`. A `blocked-by` write that fails is reported as a count while the epic and task list stay correct.

#### `josh epic --promote` — turn an existing issue into an epic

```bash
pnpm josh epic --promote 858 101 102 103 [--ordered] [--rationale-file <path|->] [--origin <owner/repo#N>]
```

Appends the epic's sections to the existing issue instead of replacing its body, so discussion and epic stay on one issue. Otherwise matches `josh epic`. Re-running is refused. Promote a request, discussion or container; when the issue is itself a deliverable, keep it as a child and create a new epic.

#### `josh epic --add` — insert children into an existing epic

```bash
pnpm josh epic --add 893 894                  # track #894, declaring no order for it
pnpm josh epic --add 893 894 --before 891     # #894 must finish before #891
pnpm josh epic --add 893 894 --after 890      # #894 starts once #890 is done
pnpm josh epic --add 893 894 --decision-file why.md   # …and record why, in one call
```

Writes all three places an epic's order lives — the task list, the `## Dependencies` arrow declaration, and the native `blocked-by` relations — from one input, so they cannot disagree.

**Options:**

- `--before <M>` — insert before `#M`, re-pointing what `#M` was waiting on so the chain is never broken.
- `--after <M>` — start after `#M`; branches when `#M` already has a successor, extends when it is a tail.
- `--order-before <M>` / `--order-after <M>` — move the task-list row only; write no `blocked-by` relation.
- `--decision-file <path|->` — record why the child was placed.
- `--remove <E> <M> <N> [<N2> …]` — delete a declared order from the body and the relations; each consecutive pair is one link.

Nothing is written unless all three places will agree. `#M` must be a child of the epic; a position naming an issue being placed, or a hub the declaration cannot position within, is refused without writing. A cross-repository target is refused with the bare-number command to run instead.

#### `josh epic --reconcile` — bring the declaration and the recorded relations back into agreement

```bash
pnpm josh epic --reconcile 2184   # rewrite the body to match the recorded blocked-by, and record any order the body declared
```

When the `## Dependencies` declaration and the native `blocked-by` relations disagree, `--add` and `--remove` both refuse and `backlog:next` reports the graph unusable — and the only other exit was to edit the epic body by hand. `--reconcile` is that repair. There is no judgement in it: a relation recorded but never declared is written into the declaration (the relation is the GitHub-side fact, the body its copy), and an order declared but never recorded is aligned by recording the relation. The result declares exactly what it records.

- It **writes no `## Decisions`** — synchronizing a copy is not a decision, so nothing is recorded on the epic or its children.
- When the two already agree it writes nothing and prints `nothing to reconcile`.
- A circular union of declared and recorded orders is refused without writing; there is nothing to reconcile a cycle to.
- On success it states that `epic:audit` and `backlog:next` now agree on the epic's order.

### `josh epic:next`

List an epic's runnable children, bundled per repository. All state lives on GitHub, so asking again after any interruption gives the same answer.

```bash
pnpm josh epic:next 858
pnpm josh epic:next 858 --repo joshuafolkken/kit   # just the next child for one repository
pnpm josh epic:next 858 --repo joshuafolkken/kit --lanes   # one child per free lane there
```

**Options:**

- `--repo <owner/repo>` — answer for one repository; stdout carries one token (an issue number, or `wait`/`stop`/`complete`), everything else on stderr.
- `--lanes` — print one issue number per free lane (requires `--repo`); `JOSH_LANE_LIMIT` sets the ceiling, default 6.

Several leading epic arguments merge into one candidate pool per repository. A cross-repository dependency resolves only when the blocker is closed **and** its declared version has published. `run`/`wait`/`stop`/`complete` exit `0`; an unusable graph (cycle, or body/relations disagreement) exits `1`.

### `josh epic:bundle`

Say whether a newly filed issue belongs with ones already in the backlog. It finds candidates and recommends; it writes nothing.

```bash
pnpm josh epic:bundle 874
```

Only two things count as a signal: the two issues referring to each other in prose, or an already-recorded `blocked-by`. A similar title never counts on its own.

| Candidates                                     | What to do                                          | Tier |
| ---------------------------------------------- | --------------------------------------------------- | ---- |
| The new issue itself already has an epic       | Nothing                                             | —    |
| Already a child of an epic                     | Add to that epic                                    | A    |
| Spread across an epic and its own parent       | Add to the inner epic                               | A    |
| Spread across different epics                  | Choose the one you recommend, add to it, record why | A    |
| In no epic, two or more counting the new issue | Create an epic                                      | A    |
| No strong signal / listing cut short           | Nothing                                             | —    |

Prints an `Order:` line with an `Evidence:` block, or `Order: none declared — do not invent one`. Exit is `0` for a verdict, non-zero only when a listing could not be read. A cut epic listing withholds every placing verdict.

### `josh epic:audit`

Read an epic's children against each other and report what contradicts what — where `epic:check` verifies one epic's format, this reads inside the children.

```bash
pnpm josh epic:audit 858
```

| Check                | Level     | What it means                                                                                                  |
| -------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| Implicit dependency  | warning   | A child's body names another child, and nothing orders the two.                                                |
| Order contradiction  | **error** | Acceptance criteria name another child with nothing ordering them (warning once either closes, or cross-repo). |
| Unresolved reference | warning   | A body cites an issue that does not exist or is already closed.                                                |
| Nested epic          | warning   | A task-list row points at another epic.                                                                        |
| Orphan child         | warning   | An issue names this epic as parent but the task list does not track it.                                        |
| Orphan search        | **error** | The open-backlog search could not be read — re-run the audit.                                                  |
| Unjustified order    | **error** | The body declares an order between two open children and nothing records why.                                  |

Only errors change the exit code. Run it at the start of a `backlogrun` epic run and after a child or dependency changes. Fixing what it finds is Tier A; park with `needs-decision` only when the contradiction is an unmade design choice.

### `josh epic:check`

Check an existing epic against the same four requirements and report each as pass or fail. Use on hand-made epics, epics predating `josh epic`, and after editing an epic body.

```bash
pnpm josh epic:check 700
```

**Output / exit codes:** exits `0` when every requirement is satisfied, `1` otherwise, so it works as a gate. The dependencies check wants exactly one of the two machine-readable forms — neither present is ambiguous, both present is a contradiction.

### `josh auto-ok:next`

Print the next opted-in standalone issue an unattended run may pick up outside an epic. Read-only; ranks newest-first, skipping `epic`, `in-progress`, `needs-decision` and any candidate whose `blockedBy` is still open.

```bash
pnpm josh auto-ok:next
pnpm josh auto-ok:next --exclude 906   # skip the issue just merged
# create the label once, where wanted:
gh api repos/{owner}/{repo}/labels -f name=auto-ok -f color=0e8a16 -f description="Opted in to unattended execution outside an epic"
```

- `--exclude <N>` — drop issues from the answer; comma-separated, repeatable.

stdout is one token — the issue number, or `none`, or empty with exit 1 if the listing could not be read; explanations to stderr.

### `josh backlog:next`

Order the whole opted-in backlog in one command — standalone `auto-ok` issues plus the descendants of every epic whose root carries `auto-ok`, followed transitively through nested epics (joshuafolkken/kit#2244). Read-only. Tokens are bare numbers scoped to the repository.

```bash
pnpm josh backlog:next
pnpm josh backlog:next --exclude 1630  # skip the issue just merged
```

- `--exclude <N>` — drop issues from every bucket; comma-separated, repeatable.

stdout is one token per line (all exit 0 unless noted): `<number>…` (each an issue a run may start, possibly in parallel), `wait` (resolves on its own), `stop` (needs a person), `retry` (429/5xx or a request that never arrived), `error` (an unusable graph; anything GitHub answered with, 403 included), `none` (nothing opted in), or empty with exit 1 if a listing could not be read. Explanations to stderr.

### `josh backlog:plan`

The whole backlog rendered as a plan a person reads before a run starts — four sections on stdout, using `backlog:next`'s own classification. Separate because that command's stdout is bare tokens a loop branches on.

```bash
pnpm josh backlog:plan
pnpm josh backlog:plan --exclude 1630  # after #1630 merged
```

- `--exclude <N>` — same exclusion as `backlog:next`.

Sections: **Ready now** (runnable children, grouped by repository = the parallelism), **Waiting** (each withheld child naming what it waits on), **Waiting on a person** (`needs-decision` children), **Out of scope** (every open issue the backlog will not run, with the reason).

### `josh backlog:stalled`

Report whether ready backlog work is sitting undispatched while a lane is free and nothing has dispatched for a while (joshuafolkken/kit#2359) — the state where a run is alive but not advancing and nobody notices until a person asks. Reads three facts, weighs none: a runnable count from `backlog:next`, the free-lane count, and the age of the last `child-launch` event on the run's stream.

```bash
pnpm josh backlog:stalled
```

stdout is one verdict word, always exit 0 — it reports, it never stops: `stalled` (all three hold), `unreadable` (no run stream to key on), or `ok`. On `stalled` it leaves a `stall` marker on the run's event stream — once per episode, which is what a terminal reader following the stream sees and what `run:step` reads as `backlog:next` — and sends one `⏳` Telegram notification. The cheap conditions gate the costly one: the backlog is only read when the run is already idle past the threshold with a free lane. Wired into the Stop hook (`stop-guard`) so it fires at each loop boundary; failures are swallowed so a report never holds a stop.

### `josh backlog:budget`

Say whether a `backlogrun` may start more work, keep watching, or finish. Read-only. Maps `backlog:next`'s answer into a budget verdict.

```bash
pnpm josh backlog:budget --answer candidates --started "$started" --active "$active"
pnpm josh backlog:budget --answer exhausted  --started "$started" --active "$active" --idle 60
pnpm josh backlog:budget --answer candidates --started "$started" --active "$active" --merged 3 --running 2 --max 5
```

- `--answer <candidates|exhausted|blocked|parked|unreadable>` — `backlog:next`'s answer, mapped.
- `--started` / `--active` — when the invocation began / when it last had work (required unless the watch is off).
- `--idle <minutes>` — after candidates run out, keep polling this long (default 30; `--idle 0` turns the watch off).
- `--max <count>` — issues one invocation may take (default unlimited); `--merged` and `--running` count against it.
- `--json` — collapse verdict and reason into `{"budget": "<verdict>", "reason": "…"}`.

stdout is the verdict word (reason to stderr): `run` (start what was offered), `watch` (sleep the interval and ask both again), `stop` (report and finish), or empty with exit 1 if the invocation is unreadable. The whole-run bound (8 hours) is decided here and outranks both budgets, but a `parked` or `unreadable` answer outranks the bound. A watch polls every 5 min.

### `josh backlog:offer`

Collapse a `backlogrun` loop-head event into one call: run `backlog:next`, map its answer to the budget word `backlogrun-steps.md` → "The loop" fixes, run `backlog:budget`, return the verdict — two turns folded into one where the parent's context is largest, as `run:merge` did for a merge event.

```bash
pnpm josh backlog:offer --started "$started" --active "$active" --running 2 --retries 1
```

`--exclude` / `--repo` forward to `backlog:next`; `--started` / `--active` / `--merged` / `--running` / `--max` / `--idle` forward to `backlog:budget` (`--answer` is computed here). `--running` also decides `wait` (→ `blocked` with children in flight, else `exhausted`) and `--retries` decides `retry` (→ `blocked` below three, `unreadable` at the third). stdout is the verdict, then — on `run` — the issue numbers one per line; the new retry count is the last stderr line (`retries: <n>`) and in `--json`. Exit 1 from `backlog:next` maps to `unreadable`, never `none`.

At the drain — a `watch` verdict over an `exhausted` answer with `--running 0` — it marks a `drain` event on the run's event stream (once per drain, best-effort), so the next `run:step` fires the end-of-run retrospective before the idle watch rather than after it (joshuafolkken/kit#2335). A watch that opened while children were still merging is not this drain and is left unmarked.

### `needs-human-review` — the opposite label

The inverse of `auto-ok`: implemented and taken through the verification gate as usual, then nothing is committed, pushed, opened as a PR or merged — the working tree is left uncommitted, a `confirmation` notification carries the resume command, and the run stops. For work no test can judge. Only a person applies or removes it.

```bash
gh api repos/{owner}/{repo}/labels -f name=needs-human-review -f color=d93f0b -f description="Implement and verify, but stop before committing so a person can look"
```

Single source: [`.claude/skills/workflow-commands/SKILL.md`](../.claude/skills/workflow-commands/SKILL.md) → §2z.

### `already-done` — the exit for work that is already merged

The exit for a run that verifies its issue's work is already in `main`: nothing to implement, and it cannot close the issue (Tier C). Not `needs-decision` — that waits for an answer; this one has its answer and only the close is outstanding. A run applies it; only a person removes it, by closing the issue.

```bash
gh api repos/{owner}/{repo}/labels -f name=already-done -f color=6f42c1 -f description="Verified already merged — a person closes it"
```

Procedure: [`.claude/skills/workflow-commands/SKILL.md`](../.claude/skills/workflow-commands/SKILL.md) → §2g.

### `josh review:brief`

Print the whole `/code-review` invocation — level, what `josh gate` proved, target and checkout. Pass the output to `/code-review`; the level is on line one.

```bash
pnpm josh review:brief            # round 1
pnpm josh review:brief --round 2  # verification pass, scoped to the fix delta
pnpm josh review:brief --level-only          # the level alone (pre-commit review)
pnpm josh review:brief --level-only --json   # level and reason, machine-readable
```

- `--round 2` — target is round 1's fixes and nothing else (widened back to the whole change when the record's change base no longer matches).
- `--level-only` — print the level alone (level to stdout, reason to stderr); bypasses the scoped-green refusal.
- `--staged`, `--json` — the staged diff; machine-readable level and reason.

It refuses to compose a brief when the scoped checks have never been green on this tree; run `pnpm josh lint:related && pnpm josh test:related`, then reissue.

The brief prints the `reviewer` profile; pass its model and effort explicitly to the review subagent.

#### The review level

`pnpm josh review:brief --level-only` prints the `/code-review` level this change is reviewed at. The input is the list of changed paths and nothing else.

| Every changed path is…                                                                   | Level    | Rounds  |
| ---------------------------------------------------------------------------------------- | -------- | ------- |
| **inert** — `.editorconfig`, `.gitignore`, `LICENSE`, `CHANGELOG.md`, `*.code-workspace` | `low`    | 1       |
| anything else                                                                            | `medium` | up to 2 |

One non-inert path decides the whole change; an empty diff also takes `medium`. Three things that look inert are not — `.vscode/**`, `.gitattributes` and `.prettierignore` are written into every consumer by `josh init` / `josh sync`. Documentation is not inert either: `CLAUDE.md`, `prompts/**`, `.claude/**` and `docs/**` stay `medium`.

### `josh review:round2`

Say whether the second `/code-review` round is due, or may be skipped. Run it once round 1's fixes are in.

```bash
pnpm josh review:round2                     # → required
pnpm josh review:round2 --round-1-closed    # → required | skip
pnpm josh review:round2 --json              # the verdict and the reason, machine-readable
```

- `--round-1-closed` — the caller states every round-1 High/Medium finding closed and none was filed or deferred; its absence answers `required`.
- `--json` — machine-readable verdict and reason.

`skip` on **Arm A** (the fix delta is empty) or **Arm B** (every path in the fix delta is inert by [`josh review:brief --level-only`](#josh-reviewbrief)'s classification); `required` for anything else, including a missing `--round-1-closed`, a missing round-1 snapshot, a snapshot against a different change base, and one non-inert path. Full reasoning: `prompts/review.md`.

### `josh disposition`

Say whether a review finding **reaches a runtime path** (`runtime`, any non-inert path) or is inert (`non-runtime`) — the machine half of the three-way disposition, sharing `review-level.ts`'s inert set, so only "is the defect confirmed" is left to a person. Verdict on stdout, reason on stderr. Full reasoning: `prompts/review.md` → "Three-way disposition after the cap".

```bash
pnpm josh disposition <path...>   # → runtime | non-runtime
```

### `josh review:attest`

Record, or verify, which checkout a `/code-review` actually read — it is forked into the session's working directory, so a lane run can be reviewed from the wrong tree. `josh review:brief` prints a nonce; `attest <nonce>` reads the checkout it is run in and exits non-zero when that is not the briefed one.

```bash
pnpm josh review:attest <nonce>   # run by the review, from the checkout it read
pnpm josh review:attest --check   # run by the run, before it acts on the review
```

- `<nonce>` — attest the checkout the review read.
- `--check` — verify before acting; `josh followup` asks again before merging.

Answers: `ok` (attested the briefed checkout), `missing` (a brief was recorded and nothing attested it — a refusal, not a pass), `mismatch` (a different root, branch or HEAD), `not-required` (no brief recorded in this checkout inside a run's lifetime). All three fields are checked; scoped to a checkout that briefed a review, expiring after eight hours.

### `josh delegate`

Say whether a step of a run may go to a cheaper execution tier. Verdict to stdout, reason to stderr.

```bash
pnpm josh delegate gate-fix   # → delegate
pnpm josh delegate review     # → keep
pnpm josh delegate --list     # the enumeration, and what was rejected and why
```

**The list is the whole of the rule: anything not on the list is `keep`.** A step earns its place by naming how a wrong result is caught — by something in the parent tier that costs less than redoing the step.

| Step                  | Delegatable because                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gate-fix`            | `pnpm josh gate` re-runs; a wrong fix fails it again, naming the file                                                                                                        |
| `epic-child`          | the parent reads the child's state from GitHub, so a child reported done but not merged shows as still open                                                                  |
| `followup-filing`     | the parent reads the filed Issue with `pnpm josh issue:state <new>`, so one reported filed but not created shows as absent                                                   |
| `survey`              | the reported locations are checked directly; a fabricated or missed one fails one `grep`                                                                                     |
| `investigation`       | the parent opens the cited lines; an unsupported conclusion fails there, far cheaper than redoing the reading                                                                |
| `implementation-unit` | the parent runs the whole change through `pnpm josh gate` and a `/code-review` it would run anyway, so a unit's mistake fails the same backstop a serial edit passes through |

**These were considered and kept**; `pnpm josh delegate <step>` answers `kept deliberately` for them, distinguishing them from a step that is merely unlisted:

| Step               | Kept because                                                                            |
| ------------------ | --------------------------------------------------------------------------------------- |
| `notify-body`      | no verifier; a wrong body is sent and read as though it were right                      |
| `issue-comment`    | no verifier; a decision log or completion comment _is_ the record, so nothing checks it |
| `status-read`      | a misread routes the run to the wrong child and no later step disagrees                 |
| `diagnosis`        | a wrong root cause produces a fix that passes the gate and leaves the defect            |
| `design`           | the cost of a wrong design is paid by every step after it                               |
| `split-assessment` | a missed split widens one Issue into a batch nobody authorized                          |
| `review`           | the review is the last thing between a defect and a merge; a cheaper one finds less     |

**`investigation` is the only row that carries a threshold, and the threshold is 3 files, and it is a count, not a forecast.** What comes back is the conclusion plus the `file:line` citations that support it, never the file text; a throwaway probe script is written, run and deleted inside the unit. **It is not `survey`, and it is not `diagnosis`**: `survey` reports where something appears and is checked by one `grep`, while a root cause stays with the main line. `pnpm josh delegate --list` prints the count. **A delegation resets the counter rather than spending it** — the counting moved into `josh investigation:guard`.

**The mechanism is not the unit.** **One row covers both batch entry points**: an epic's child and one named issue of a `backlogrun` are the same unit, so both were wired to `epic-child`. **`followup-filing` is a third such unit**: the parent composed the finding text either way, so the unit's work is mechanical. **`implementation-unit` is a fourth**: the writing of one Step 0 unit goes to a subagent while the design that decided _what_ to write stays in the main line, and only file-disjoint units split — `josh fanout` confirms that mechanically, so two subagents never race on one file. Rule: `.claude/skills/workflow-commands/SKILL.md` → "2b. Delegating a step to a cheaper tier".

### `josh fanout`

Say whether proposed implementation units are file-disjoint, so they may be dispatched in one fan-out turn. Each argument is one unit's comma-separated file list; the verdict is on stdout, the reason on stderr — the same shape as `josh delegate`.

```bash
pnpm josh fanout scripts/a.ts,scripts/a.test.ts scripts/b.ts   # → parallel
pnpm josh fanout scripts/a.ts,shared.ts scripts/b.ts,shared.ts # → serial (units share shared.ts)
pnpm josh fanout scripts/a.ts                                   # → serial (fewer than two units)
```

**File-disjointness is the necessary condition, and it is mechanical.** Two subagents editing one file in parallel race on it — the later write lands on the earlier, or the gate has to reconcile a collision the parallelism was meant to save. So the split is refused the moment any file appears in more than one unit, and the naming of what collides is on stderr. **The default is serial**: fewer than two units is nothing to run in parallel, and an Issue whose units share files stays serial exactly as one that will not split does.

**This is the precondition the `implementation-unit` delegation row reads, and the procedure around it is one fan-out turn:**

1. From the Step 0 change list, group the `<what changes> — Test: … — <file path>` rows into candidate units, each a set of files no other unit touches.
2. Ask `pnpm josh fanout` with each unit's file list. On `serial`, write the change in the main line as usual. On `parallel`, continue.
3. **Launch every unit's subagent in a single turn** — the turn-batching principle (§2h of the workflow-commands skill) reaching the `Agent` launches, not one subagent after another — each briefed with its own files and its slice of the Step 0 table.
4. The main line keeps the design that decided _what_ to write, integrates the returned edits, and runs the one `pnpm josh gate` and `/code-review` over the whole. That gate and review — which the parent runs anyway — is the row's verifier: a unit's mistake fails the same backstop a serial edit passes through, and the disjointness `josh fanout` confirmed keeps two units from colliding on a file. The design stays in the main line, which is why `design` is rejected while the writing is delegated.

### `josh split:assess`

Measure a branch's change size and answer the split assessment's size question. It counts changed files and changed lines against `main`, **excluding test files** (`*.test.ts` / `*.e2e.ts`), and answers `split` only when both guides are exceeded together, `single` otherwise.

```bash
pnpm josh split:assess          # → single
pnpm josh split:assess --json   # the verdict and the reason, machine-readable
```

`split` needs **both** the file guide (10) and the line guide (400) exceeded; either alone, or an empty diff, is `single` — the conservative default of `.claude/skills/workflow-commands/split-assessment.md` → "The question". It answers the **size** question only: separability stays a judgement, so `split` is the size condition met, not a decision to divide the Issue. Untracked files have no diff base — commit before measuring for an exact count.

### `josh oracle:list`

Print the decision oracles — commands that answer a rule question from mechanically readable inputs alone (question 0 of the rule-placement criterion, `prompts/collaboration-workflow/residency.md` → question 0). Each row carries the command, its answer vocabulary, its **firing point** (or the reason none can be named) and its single-source document. Adding a new oracle means adding a row here and a firing-point declaration in `scripts/rules/oracle-firing.ts`, and nowhere else.

```bash
pnpm josh oracle:list
```

- **The firing point is what makes an oracle enforced** (joshuafolkken/kit#2324). A declared firing point — the action the oracle must precede — wires a generic `oracle-consulted` delivered rule that refuses that action until the oracle's command has run (`scripts/rules/oracle-consulted.ts`). Two are wired: `pkg:scout` (a package add) and `issue:lint` (an Issue filing). `release:scope` is on the reason side, not a firing point: it reads the release owed _after_ `pnpm josh followup` merges, so it trails the merge rather than gating it (joshuafolkken/kit#2334). The rest declare why no firing point can be named and stay **visibly unenforced** rather than silently so, so a new oracle must always answer whether it has a firing point.
- Single source: `scripts/rules/decision-oracle.ts` (the enumeration) and `scripts/rules/oracle-firing.ts` (the firing points).

### `josh rule:value`

Print each delivered rule's **unaided compliance** — how far the carried text alone kept the rule in the window before its trigger fired (`scripts/rules/rule-value.ts`). One row per rule: the runs that reached the situation it governs, the rate kept before the trigger (or `unmeasured` where the rule declares no `keeps` predicate, `unreached` where no run reached it), and the refusals the hook actually delivered.

```bash
pnpm josh rule:value
```

- Transcripts are grouped by the run they belong to, so a lane's transcript counts with the parent that dispatched it rather than as a run of its own.
- It reports and never fails: an environment with no measurable transcript prints `no measurement targets` and exits zero.
- Called once per iteration from the `backlogrun` loop head (`josh backlog:offer`), so a rule that never fires appears as a printed row rather than as something a person has to think to measure (joshuafolkken/kit#2271). Single source: `scripts/rules/rule-value-cli.ts`.

### `josh clone:scan`

Count code duplication across files and first-party repos (`JOSH_REPO_PATHS` included) — the measurement `no-clones` lacked. Output: `clean`, or `clones: <N>` then each clone `[same-file|cross-file|cross-repo]` with `file:line` (exit 0). Single source: `scripts/clone/clone-scan.ts`.

### `josh cases`

Read changed paths and print the I/O boundaries the diff crosses (`network` / `process` / `fs` / `none`) and, for each, the mandatory abnormal cases a test declaration must account for (non-200, timeout, empty response, malformed JSON, rate limit). A decision oracle: the unit suite blocks network by design, so these cases are confronted at declaration time. Single source: `scripts/cases/cases-cli.ts`.

### `josh run:hold` / `josh run:release`

Guard a working tree so only one run holds it at a time — `run:hold` claims it, `run:release` clears the claim. The unit is the working tree, so two lanes of one repository key differently.

```bash
pnpm josh run:hold 1091          # claim for issue 1091
pnpm josh run:release 1091       # release this run's own record
pnpm josh run:release --force    # clear a record left by a run that has ended
```

**Options:** `--force` (`run:release`) removes a record this run did not write, clearing another run's stale claim.

**Output / exit codes:** stdout is one token; explanations go to stderr. `run:hold`: `hold`, `busy`, `reclaim` / `resume` / `park` (preflight found uncommitted work, an existing branch/PR, or a merged/closed PR), `unknown` (exit 1). `run:release`: `released`, `none`, or `held` (exit 1). A record over 8 hours old on a clean tree is replaced; on a dirty or unreadable one, `busy`.

### `josh run:carry`

Carry one invocation's budget across its own session cuts, so a resumed `backlogrun` continues the authorized run instead of starting a second one.

```bash
pnpm josh run:carry --begin "backlogrun --max 5" --owner "$PPID"
pnpm josh run:carry --json                          # read the record back in a resumed session
pnpm josh run:carry --cut --owner "$PPID"           # hand the record off before a cut
pnpm josh run:carry --retrospective --summary "0 filed; dropped #2240 already merged" --owner "$PPID"  # close the end-of-run retrospective
pnpm josh run:carry --resume "backlogrun --max 5" --owner "$PPID"  # adopt a record no cut handed off
pnpm josh run:carry --end --stopped "epic #2126: everything is blocked behind parked #2118"  # end + push
```

**Options:**

- `--owner <pid>` — the long-lived process spending the budget (`$PPID` under a loop); required by counts and `--begin` / `--resume`. A live PID stays `busy` if probes fail.
- `--done <issue>` shrinks a named-issue run's `remaining` list; `--merged` / `--filed` / `--cut` are increments, never totals.
- `--retrospective` marks the end-of-run retrospective run, once per invocation, and requires `--summary <text>` — the same close writes that result as one `retrospective` event on the run's event stream (best-effort), so a run that filed zero improvements reads apart from one whose retrospective never ran (joshuafolkken/kit#2342). Either flag without the other is refused.
- `--stopped <reason>` rides on `--end`: the run ended by _stopping_ rather than finishing, so one ⏸️ confirmation is pushed with the reason as the record is cleared, reaching the person after a cut a headless parent's report would not (joshuafolkken/kit#2136). A bare `--end` (a clean finish) stays silent, and because `--end` removes the record a second `--end --stopped` never sends twice. Named without `--end` it is ignored.

**Output / exit codes:** stdout is one token (`--json` prints the record on one line). `began`, `resumed`, `carried`, `counted`, `ended`, `expired` exit 0; `busy`, `standing`, `mismatch`, `unreadable`, `unknown` exit 1; `none` exits 0 for a read/end, 1 for a count/resume.

### `josh run:wake`

Continue a cut `backlogrun` by waking the next session from outside the conversation. It reads the carry record and wakes only on `carried`, handed off by `run:carry --cut`.

```bash
pnpm josh run:wake --start                 # launch the detached supervisor
pnpm josh run:wake --list                  # supervisor state, cut/wake counts, latest progress line
pnpm josh run:wake --stop                  # stop it
pnpm josh run:wake --loop --interval 30    # run the loop body in the foreground
```

`scheduler` runs provider; listings show profile/result. Anthropic defaults. OpenAI uses worktree-local
`sqlite_home` and `--ephemeral`, retaining native auth/config. Unclaimed wakes try thrice.

**Output / exit codes:** stdout is one token; stderr explains. `started`, `running`, `supervising`, `stale`, `stopped`, `ended`, `expired`, `unreadable` exit 0; `none` exits 0 for `--list` / `--stop` and 1 for `--start`; `failed`, `unknown` exit 1. `expired`, `unreadable`, and `failed` each warn.

### `josh run:cut`

Cut a dispatched lane child before the verification gate. OpenAI uses its lane supervisor; Anthropic
relaunches directly. With no matching supervisor, OpenAI returns `failed` before writing the cut.

```bash
pnpm josh run:cut 1839                          # take the cut and hand it to a fresh process
pnpm josh run:cut --impl 1839 --handoff h.json  # cut mid-implementation, carrying the instruction
pnpm josh run:cut --resume 1839                 # a fresh process's entry check
pnpm josh run:cut --end                         # clear the record
```

A cut that resumes back into implementation (`--impl` / `--setup`) carries a **handoff** — the run's
instruction verbatim and a curated list of what is done, what remains, and what was deliberately left
alone (joshuafolkken/kit#2354). It is passed by path with `--handoff <path>`, never inlined, so a
backtick or `$` in the instruction is not executed. The record stays small (bounded, a few short
lines); the resume prints the handoff to stderr so the fresh process continues on the instruction
rather than the working tree alone, and a resume that finds no instruction is refused `incomplete`
rather than continuing blind.

**Output / exit codes:** stdout is one token. `run:cut <N>`: `cut`, `not-a-lane`, `unready` (clean or default-branch tree), `busy`, `failed`, or `bad-handoff` (an unreadable or oversized `--handoff`). `run:cut --resume <N>`: `fresh`, `resume`, `resume-impl`, `stale`, `busy`, `handed-off`, or `incomplete` (matched the tree but carried no instruction).

### `josh run:liveness`

Say whether the delegated unit running a child is still working, or stopped without reporting. Two traces decide it: whether the transcript grew, and whether a child process is alive.

```bash
pnpm josh run:liveness 1169 --output <path> --process none
pnpm josh run:liveness 1169 --output <path> --process alive --window 45 --gap 2 --repo joshuafolkken/app-kit
```

**Options:**

- `--output <path>` — absolute, under the home or temp directory; a symlink is followed and size compared as well as mtime.
- `--process alive | none` — the result of the caller's own `pgrep -laf` against the child's checkout.
- `--window <min>` — silent window the file must be frozen for (default 30); `--gap <sec>` — spacing between samples (default 5); `--repo <owner/name>`.

**Output / exit codes:** stdout is one token; stderr explains. `alive`, `stopped`, `settled` exit 0; `undetermined` exits 1. Growth in the transcript answers `alive` on its own. Two `undetermined` answers in a row is a check fault; the caller stops polling rather than escalating to `stopped`.

### `josh run:ending`

Classify how a dispatched lane child _ended_ — a different question from `run:liveness`'s "is it still going". `run:liveness` cannot see a child that stopped mid-implementation: its output freezes exactly as a completed child's does, and a `subtype: success` exit reads as a clean finish. This reads three traces the child leaves behind — a carried cut record (it handed off), a CLOSED Issue (it merged), or an OPEN Issue with no cut (it ended in the middle) — and, for the last, prints the exit-record basis a park comment should carry.

```bash
pnpm josh run:ending 2118 --output <path>
pnpm josh run:ending 2118 --output <path> --repo joshuafolkken/app-kit
```

**Options:**

- `--output <path>` — the child's transcript, absolute and under the home or temp directory (validated the same way `run:liveness --output` is).
- `--repo <owner/name>` — a child in another repository.

**Output / exit codes:** stdout is one token; stderr carries the reason and the basis. `merged`, `cut`, `outage`, `abandoned` exit 0; `unreadable` exits 1. The verdict never reads `is_error: false` as a completion — completion is the CLOSED Issue. A mid-implementation ending is split in two (joshuafolkken/kit#2240): `outage` when the exit record ended in error on a transport-failure signature — the API could not be reached — and `abandoned` otherwise. The `abandoned` basis names the exit-record fields read (`subtype`, `num_turns`, `permission_denials`) and whether work remains; the `outage` basis names the signature, so the parent leaves the child re-dispatchable.

### `josh run:prep`

Bundles the reads a run makes before its first edit into one call.

### `josh run:entry`

Opens a run in one call, folding the four-round-trip entry sequence a lane re-billed its context on
(joshuafolkken/kit#2372): `run:hold`, `cost --cut` (skipped in a dispatched lane child), `run:prep` and
`run:step`. The `entry #<N> — hold: … · cost: … · verdict: …` line carries the three facts the run
branches on; a `busy`/`unknown` hold or an `over` budget short-circuits with a non-zero exit — the
shape `backlog:offer` folded the parent loop head on.

### `josh run:status`

Bundles a run's read-only status — issue state, `cost --cut` verdict, and carry counters — in one
call, `--repo` for a cross-repo child. Writes nothing (joshuafolkken/kit#2165).

### `josh run:next`

Prints the next step a `fullrun` takes, computed from the run's state rather than read out of prose (joshuafolkken/kit#2188). It reads exactly what `run:prep` reads — the issue state, the
`human_review` line and the dependency scope — by calling `run:prep`'s own gather, and maps the four
facts to one step: a `CLOSED` issue is already done, a `required` dependency scope is updated first, a
`needs-human-review` issue stops before its commit, and everything else is the ordinary implement step.
It is the consumer #2165's `run:prep` was built to have and the foundation the entry-read trim of epic
#2166 rests on.

### `josh run:step`

Prints the run's next single action, computed from the event stream (`run:event`), the carry record
(`run:carry`) and the issue state (`run:prep`) — never the conversation
(joshuafolkken/kit#2248). It lifts `run:next`'s fold from an _event_ to a whole _run_, printing one
line: a runnable command for a phase that has one (`followup` after a PR opens, `run:merge <N>` after a
merge, `backlog:next` after a park, `run:cut --resume <N>` after a cut), a fixed verdict otherwise
(`implement`, `human-review`, `update-deps`, `already-done`, `wait`, `stop`, `unknown`), or a `decide:`
line for the one Tier-B point it surfaces — a spent whole-run budget. It dispatches rather than
re-decides: a merged child's outcome stays `run:merge`'s, the next issue `backlog:next`'s. `run:next`
is now its degenerate form — the pre-implementation position mapped to prose over the one shared
mapping, so there is no second implementation.

In a **dispatched lane child** (read from the dispatch mark, `lane-child-marker.ts`) a merge or an
outage position prints `stop` rather than `run:merge <N>` (joshuafolkken/kit#2297): `run:merge` is the
parent's own budget command and returns `busy` in a child, so a child is never pointed at it (the
complement of the runtime `lane-carry-conflict` refusal).

The **end-of-run retrospective is opt-in**, gated by `JOSH_RETROSPECTIVE`
(joshuafolkken/kit#2370). The drain and stop positions print the retrospective command only when it is
set to `on` / `1` / `true` / `yes` (trimmed, case-insensitive), and print `wait` / `stop` otherwise.
Its **default is off** — an unset or unrecognized value leaves it off, so a typo cannot enable it and a
checkout that writes nothing to `.env` never auto-files improvement issues. The switch gates only
whether the step is printed: the retrospective's own logic is untouched, `pnpm josh retrospective`
still runs by hand, and the three existing exclusions (a lane child, a done retrospective, a consumer
checkout) are unchanged.

### `josh repo:party`

Says whether a repository is **first-party** or **third-party** — computed by owner equality, not
judged (joshuafolkken/kit#2122). Prints one of `first-party` / `third-party` / `unknown`
on stdout, and the two owners it compared on stderr.

```bash
pnpm josh repo:party joshuafolkken/kit     # → first-party (in the kit session)
pnpm josh repo:party sveltejs/kit          # → third-party
pnpm josh repo:party                        # no argument: the session's own repository
```

The target's owner equals the session repository's owner → `first-party`; it differs → `third-party`;
either owner cannot be read (no `origin`, an unreadable config, a malformed argument) → `unknown`,
which is never read as `third-party`. This is the mechanical test `CLAUDE.md` → "Third-party
repositories are Tier C" and `prompts/collaboration-workflow/upstream-interrupt.md` describe; the
`third-party-write` row of `delivered-rules.ts` computes the same thing to refuse a `gh api` write to a
repository we do not own (a read passes untouched).

### `josh run:merge`

Collapses a `backlogrun` merge event into one call (joshuafolkken/kit#2024). The parent
calls it once at a child's return and reads back the next child number — or a control verdict.

```bash
next=$(pnpm josh run:merge <N> --epic <E> --repo <owner/repo> --owner "$PPID" --output <path>)
pnpm josh run:merge <N> --owner "$PPID"   # backlog offer (no epic)
```

Confirms the child from GitHub and, by what it turned out to be, does the post-merge steps: a **merged**
child (CLOSED) is counted into the carry record (which resets the failure streak), then `main:sync`,
`lane:close <N>`, and the counters mirrored onto the epic comment; a **parked** child (`needs-decision`
or `already-done`) is left alone; an **outage** child (OPEN, unparked, exit record shows it could not
reach the API — joshuafolkken/kit#2240) has its stale `in-progress` dropped but is **not** parked and
**not** counted, staying re-dispatchable; a **failed** child (OPEN, unparked, not an outage) has its
stale `in-progress` dropped, is parked with `needs-decision`, and counts against the failure guard.
`--output <path>` names the transcript the outage split reads; absent, it is off.

**Output:** one child number (or several, one per free lane), or a verdict token. Beyond the offer
`epic:next` prints (`run` becomes numbers; `wait` / `stop` / `complete` / `error` pass through), it adds
`over` (the merge crossed the shared 200,000 context threshold, so hand the lanes over and cut), `human-review` (the child stopped
before its commit — stop), `stop` (failure guard), `environment` (the consecutive-outage guard tripped —
the API is down), `retry` (unreadable), `busy` (refused count; exit 1).

**Options:**

- `--epic <E> --repo <owner/repo>` — offer the epic's next children; omit both for the opted-in backlog.
- `--owner <pid>` — the parent's process, so the carry count respects the ownership guard.

### `josh run:review`

Starts the gate in the background and prints the whole `/code-review` brief in one call, so a lane
child launches the two together and they overlap (joshuafolkken/kit#2179). It composes
`josh gate` and `josh review:brief` and changes neither, so `review:attest --check`'s nonce/checkout
contract is minted exactly as before.

```bash
pnpm josh run:review          # detach the gate, print the brief; then launch the /code-review subagent
pnpm josh run:review --join   # after the review returns: join the gate, check its verdict
```

The default waits only for the gate to _start_ (never for the checks to pass) and prints the brief;
`--join` waits for it to finish, prints the gate/review overlap, and **exits non-zero on a red gate** —
the mechanical form of "a review verdict is not adopted over a red gate". The overlap's reader is
joshuafolkken/kit#2179 and `chain-rule.md`.

### `josh run:tail`

Closes a run in one call, folding the three-round-trip post-merge sequence (joshuafolkken/kit#2372):
`observations:flush`, `issue:cite` (the closed issue and any follow-ups filed this run) and
`release:scope`, run in order — the ledger commits before the release scope reads main — and joined
under one header per step, non-zero if any failed. It folds only bookkeeping; the review verdict, the
merge and the push above it stay their own calls.

### `josh run:report`

Generates the session-facing report _from_ the run's event stream, rather than composing the wording by
hand each run (joshuafolkken/kit#2249). It reuses `run:event`'s `format_event` for every
line — merges, parks with their reason, cuts — and appends the release tail `release:scope` decides (the
request and the command on `required`, `unknown` printed as `unknown`, silent on `skip`). The printed
body is the Telegram body too: `josh notify --body-file` sends exactly this output, so a session's
summary and the off-screen message are one string from one generator, and the AI writes only Step 0's
three lines.

```bash
pnpm josh run:report   # print the report; the same text josh notify sends
```

### `josh run:event`

Appends to, or reads back, the run's append-only ordered event stream (joshuafolkken/kit#2205). Keyed to the run's identity — the common git directory `run:carry` uses — so parent and every
lane child append to one stream that survives a session cut; `--from` reads everything after a position,
`--last` the newest event alone, and `--follow` the reader an attached session relays with
(joshuafolkken/kit#2207).

```bash
pnpm josh run:event --append <kind> <text>   # append one event; prints its position
pnpm josh run:event --from <position>         # every event after <position>, in order (JSON)
pnpm josh run:event --follow <position>       # relay new events, waiting for one; position on stderr
pnpm josh run:event --last                    # the newest event alone
```

`--follow` is `--from` that waits: it returns the moment an event is past `<position>` and otherwise at
the interval, so an attached session sees a new event at once and the run's aliveness while quiet. Events
go to standard output to relay verbatim and the next position to standard error — the same before and
after a cut, the stream the run's, the position the caller's.

`<kind>` is one the single enumeration names (`plan`, `child-launch`, `merge`, `park`, `outage`, `cut`,
`stop`, `pr-opened`, `review-round`); a kind outside it is refused. `run:merge` appends `merge`, `park`
and `outage`; other steps call `--append`. The stream is bounded, so an unattended run cannot grow it
without limit.

### `josh run:progress`

Report an unattended run's progress once it has gone quiet — the one josh command meant to be started and left running in the background.

```bash
pnpm josh run:progress --output <path>
pnpm josh run:progress --once                    # five labelled lines now, whatever the clock says
pnpm josh run:progress --interval 20 --repo joshuafolkken/app-kit --hours 4
```

**Options:**

- `--mark` — record that a real report happened without printing a line (keeps the last line for `run:wake --list`).
- `--path` — print the ambient heartbeat log's path and exit. Every heartbeat line is mirrored there beside the report clock, so a person keeps it open with `tail -F "$(pnpm josh run:progress --path)"` to watch the run stream on across a `backlogrun` session cut without typing for `--list` (joshuafolkken/kit#2156). Reads no run state, so it answers in a lane child too.
- `--interval <min>` — silence interval (default 20; also `JOSH_PROGRESS_INTERVAL_MINUTES`, then `josh.progress_interval_minutes`).
- `--hours <n>` — how long the watcher lives (default 1); `--repo <owner/name>` scopes the read.

**Output / exit codes:** stdout carries only the five labelled progress lines; notices go to stderr. `--once` with no run recorded prints nothing and exits 0; an unreadable listing exits 1. It sends no Telegram; `JOSH_PROGRESS=0` reports nothing (`--mark` still records).

### `josh run:watcher:guard`

Guard hook: exits non-zero when lane children are in-flight but `run:progress` has not pinged its life record recently (within three watcher ticks, roughly 90 s). Wired as a `PreToolUse` hook so the agent cannot issue the next Bash call while the watcher is stale.

```bash
pnpm josh run:watcher:guard
```

**Output / exit codes:** exits 0 when no lane children are in-flight or the watcher is fresh. Exits 1 and writes a note to stderr telling the user to restart `run:progress --wait` before proceeding.

### `josh lane:open` / `josh lane:close` / `josh lane:list` / `josh lane:prune`

Open and close a lane: one linked git work tree with its own branch and its own port seat. `lane:open` cuts from `refs/remotes/origin/<default>` (falling back to the local branch), attaches to an existing `<N>-lane` branch, installs dependencies (`pnpm install --frozen-lockfile`), and warms the gate caches from the main checkout. It also copies the pre-built hook bundles (`dist/hooks/`) from the main checkout so the lane's Claude Code hooks launch off `node dist/hooks/<name>.js` rather than the slower `pnpm josh …` fallback — those bundles are git-ignored, so a lane's work tree never carries them otherwise. A consumer repository needs no such copy: its hook commands already point at `node_modules/@joshuafolkken/kit/dist/hooks/`, which the install materializes; only kit's own lanes use work-tree-relative paths. When the main checkout has no bundles (a clone that never ran `pnpm build`), the lane opens on the fallback path, and a copy that fails never fails the open — best-effort, exactly like the gate-cache warming.

```bash
pnpm josh lane:open 1490    # prints the lane directory on stdout
pnpm josh lane:close 1490
pnpm josh lane:close --all
pnpm josh lane:list
pnpm josh lane:prune
```

**Options:**

- `lane:close --all` — close every lane; `lane:prune` — close lanes left registered without a work tree.

**Settings:**

- `JOSH_LANE_ROOT` — where lanes go; unset means `.<repository-name>-lanes`, a hidden sibling of the repository root.
- `JOSH_LANE_LIMIT` — how many lanes one repository may run at once (default 6); applied by `josh epic:next`.

**Output / exit codes:** `lane:open` prints the directory on stdout (an empty capture plus non-zero exit is a refusal); explanations go to stderr. Seats are `1..9` (main work tree is seat 0), claimed atomically. A failed install fails the command; warming is best-effort. `lane:list` prints one line per lane — issue, seat, ports, branch, state, directory, output path, and profile.

**The `in-progress` / lane difference:** `epic:next` counts lane occupancy from the `in-progress` label list, while the lanes are the work trees actually open — and the two can disagree. `lane:list` names the difference on stderr, in both directions: an issue that carries `in-progress` but has no open lane (a stale label that silently shrinks the free-lane count), and a lane whose issue carries no `in-progress` label (which lets another session claim the same issue). The per-issue judgement is three-valued — `live`, `stopped`, or `unknown` when the lane listing could not be read — and `unknown` is never collapsed to `stopped`. It reads the two sets the way `epic:next` and `lane:list` already read them, and **it never changes a label** — clearing `in-progress` from a live run is a person's to do, since removing it is exactly what opens a second pull request.

#### `josh lane:output`

Record — or read back — where the delegated unit running this lane's child writes, so a session that did not open the lane can still poll it.

```bash
pnpm josh lane:output 1713 /abs/path/to/agent-7.jsonl   # record it; prints the path back
pnpm josh lane:output 1713                              # read it; prints the path, or `none`
```

The record lives in the lane's own `.env`; a lane whose `.env` cannot be read is refused rather than replaced.

**Output / exit codes:** the recorded path prints on stdout. `none` prints and exits non-zero (the lane is open but its child is not handed over yet).

#### `josh lane:dispatch`

Start a lane's child as a detached OS process, so cutting this session abandons nothing.

```bash
pid=$(pnpm josh lane:dispatch 1749)   # prints the child's pid; a refusal is an empty capture and exit 1
```

The invoking CLI selects the worker provider: Codex sessions use a detached
non-AI supervisor for Codex generations, while Claude Code sessions run unchanged `claude -p`.
SQLite stays lane-local; worker rollout files persist for active-usage cuts. Native auth/config stay
put. The printed PID is the supervisor's.

**Before it launches, it applies the `in-progress` label to `#<N>`** (creating the label if missing), so the lane counts as busy from the dispatch rather than only once the child's own `fullrun` reaches its apply — that window used to be tens of minutes. If the label cannot be applied it launches nothing and refuses; if the launch then fails it removes the label again, leaving no `in-progress` on an idle issue.

**Options:**

- `JOSH_{SCHEDULER,WORKER,REVIEWER}_MODEL` — Claude Code role overrides; Anthropic defaults are respectively `opus`, `opus`, and `opus`. Codex keeps its provider-specific model.
- `JOSH_{SCHEDULER,WORKER,REVIEWER}_EFFORT` — role effort overrides for either provider; defaults are `medium`, `medium`, and `high`.

Blank means unset. The inherited agent session identifier selects the provider; a missing or
conflicting identifier refuses launch. Invalid model/effort or unavailable selected CLI/auth
refuses launch. There is no provider fallback, promotion, or worker retry. OpenAI
defaults to `gpt-5.6-sol` with scheduler/worker/reviewer efforts `medium`/`medium`/`high`. Legacy
`JOSH_LANE_MODEL/EFFORT` is worker-only; migrate to `JOSH_WORKER_MODEL/EFFORT`. See the [worker
evaluation procedure](./backlogrun-worker-evaluation.md).

**Output / exit codes:** prints the child's pid on stdout. Every refusal exits non-zero and sends a `warning` — including one because the `in-progress` label could not be applied (no log path, since nothing started). A child that started but whose log could not be opened warns and exits zero (`dispatched`).

#### `josh lane:await`

Block until any of the named in-flight lane children confirms it has completed, then print which issue finished.

```bash
pnpm josh lane:await 1749 1750   # block until either lane completes
```

Polls each child's process every 5 s with a 15 s re-confirm window, so a process that briefly disappears (the pre-gate cut handoff) is not mistakenly declared done. Prints the issue number of the first child that confirms completion and exits 0; does not exit until one confirms.

#### `josh lane:launch`

Collapse a `backlogrun` lane-start event into one call: open the lane, then — only with `--stash`, which the caller passes for the first lane alone — pop that stash into it and re-install against the lock it brought in, then dispatch the child. A thin layer over `lane:open`, `stash:pop` and `lane:dispatch`, reusing their guards and messages.

```bash
pid=$(pnpm josh lane:launch 1749) || exit 1                                                  # every lane after the first
pid=$(pnpm josh lane:launch 1749 --stash "backlogrun: josh latest before lanes") || exit 1   # the first lane only
```

The child's pid is the one thing on stdout; a refusal is an empty capture beside a non-zero exit, as `lane:dispatch`'s is. A refused `lane:open` (`full` / `already-open` / failed install), a refused pop, or a failed re-install each stop the launch before the child is dispatched.

### `josh cost`

Answer whether the next turn exceeds a threshold from active-provider usage. `--cut` selects the shared 200,000 limit; `--over <tokens>` sets an explicit one. The old report scopes and `--cap` are retired; `josh time` retains hand-off aggregates.

```bash
pnpm josh cost --cut             # compare billed input per request with the shared 200,000 context-cut threshold
pnpm josh cost --over <tokens>   # compare with an explicit limit
pnpm josh cost --cut --path <dir> # Anthropic project or current OpenAI worktree
```

**Options:** either threshold prints `over` / `under` on stdout and measured input per request on stderr. `--path <dir>` selects another Anthropic project; OpenAI accepts only linked checkouts of the current project. OpenAI workers persist each generation's rollout, whose pre-terminal `token_count` events are read only when thread ID and normalized project cwd match.

**Output / exit codes:** no threshold selector prints usage; absent provider usage exits non-zero and says where it looked; a session with no requests says so rather than answering a verdict.

### `josh doc:section`

Print one section of a markdown document, so a `` `X.md` → "Heading" `` pointer costs a heading rather than a whole file.

```bash
pnpm josh doc:section <file.md> "<heading>"
pnpm josh doc:section backlogrun.md "The hand-off"
```

**Options / behavior:**

- A bare name resolves inside `.claude/skills/workflow-commands/`; anything that resolves as a path is taken as one.
- The section prints verbatim with its subsections (a `##` heading carries its `###` children).
- The heading matches as a prefix, exact match first; two prefix matches is a refusal naming both.
- Fenced blocks are skipped so a `#`-column comment inside a fence does not end the section early.

**Output / exit codes:** an unresolvable heading exits non-zero and lists the document's own headings.

### `josh read:set`

Say what a workflow entry point reads before it starts, and what that read costs.

```bash
pnpm josh read:set              # every entry point
pnpm josh read:set backlogrun   # one of them
pnpm josh read:set backlogrun --json
```

Two figures under one definition, which is what makes a before and an after comparable:

| Figure   | What it counts                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `whole`  | Every file in the set read in full, the cross-referenced ones included — what a run pays with no way to fetch a heading |
| `scoped` | The set's own files in full plus the referenced **sections** alone — what the same run pays with `josh doc:section`     |

- **The set is derived, never transcribed.** The files come from `SKILL.md` → "1. Which file to read" and the sections from the `` `X.md` → "Heading" `` references those files carry.
- `SKILL.md`'s own cross-references are not counted; a reference into a file the entry already reads whole, into `CLAUDE.md`, or into a `prompts/` topic is not counted either.
- **An unresolvable reference is charged at its whole file** — reporting it at zero would let a broken pointer read as a saving.
- A file cited more than once is charged once, over the union of the lines its references cover.
- Each file row names the tool that can deliver it whole; a file over the Bash cap is marked `Read (over the Bash cap)` — one `Read` call per file, never `cat`.
- A `-- read at the point of use, not at the entry --` block lists `latest-gate.md`, `followup.md`, `chain-rule.md`, `background-commands.md` and `pre-gate-cut.md` with their costs; they are listed, not counted in `whole`/`scoped`. `pre-gate-cut.md` joined the list in joshuafolkken/kit#2289 — it is the single source of the pre-gate cut every implementing run and every dispatched lane child reaches, so its ~10k-token read was a point-of-use read the count had silently omitted.
- `total read` sums the scoped entry read and the point-of-use documents that entry actually reaches — the figure a before/after compares.
- **Every row and the total carry a per-run dollar figure**, and the report states the run size it assumes (`$ = cost per run, assuming a 118-request run`). A token read at the entry rides every later request as cached context, so its cost is the per-token cache-read rate times the request count — which is why a document worth a few thousand tokens costs real dollars per run. The rate is `cost-pricing.ts`'s, read rather than copied, so there is no second price list; the run size is one constant (the measured mean of the 2026-09-21 backlogrun, epic #2280).
- **`lane-child` is a synthetic entry**, not a table keyword: `pnpm josh read:set lane-child` prints the trimmed set a dispatched lane child (`JOSH_LANE_CHILD`) reads — it drops the point-of-use documents the parent owns (child dispatch, lane opening, the progress watcher and the hand-off) and reads the entry-only `SKILL.md` sections (§2a/§2c/§2e/§2i/§3) at the section level, so its `total read` falls well below a normal `fullrun`'s (joshuafolkken/kit#2021).
- **`backlogrun` prints a trimmed parent set** the same way (joshuafolkken/kit#2256): the parent is the scheduler and never implements, so the implementer-only `SKILL.md` sections (§2a/§2f/§2g/§3) are read at the section level rather than whole. It is a _different_ trim from the lane child's — the parent keeps §0/§2b/§2c/§2e/§2i, which are the scheduler's own, and drops no point-of-use document, since it is the one dispatching children and running lanes.

**Output / exit codes:** an unrecognized keyword is refused with the known ones listed, rather than reporting a saving of zero.

### `josh doc:read`

A Bash-cap-safe read path for a whole document (joshuafolkken/kit#2188).

```bash
pnpm josh doc:read CLAUDE.md          # under the cap: prints the document
pnpm josh doc:read backlogrun.md      # over the cap: prints a directive, no content
```

- Resolves the file exactly as `doc:section` does — a bare name inside `.claude/skills/workflow-commands/`, anything that resolves as a path taken as one.
- **Under the Bash output cap it prints the document; over it, it prints one line and no content.** A `cat` of a document larger than `BASH_MAX_OUTPUT_LENGTH` hands back a middle-truncated preview and the file is then read a second time (joshuafolkken/kit#1797); this never emits the over-cap document through the shell, so no truncated preview is produced. The directive names both byte figures and the path, so the `Read` tool reads it once.
- The cap is read from `.claude/settings.json`, the same figure `read:set` marks its rows against; `doc:section` remains the way to fetch a single heading when the whole file is not wanted.

**Output / exit codes:** an unreadable file exits non-zero; an over-cap document prints its directive and exits zero.

### `josh read:files`

Read several files in one call, so the reads that precede a run's edits fold into one turn (joshuafolkken/kit#2202).

```bash
pnpm josh read:files a.ts b.ts c.ts   # under the cap: prints each file under its own header
pnpm josh read:files a.ts big.ts      # over the cap: prints a directive to Read them in one turn, no content
```

- **The mid-implementation counterpart of `run:prep`.** `run:prep` folds a run's pre-edit reads at a pre-determined point; this folds the reads of the files Step 0 enumerated as edit targets, routed at the Step 0 seam by `report-format.md` beside the `josh lines` step. The interleaved read-then-edit sequence the batching guard could not reach in a lane child (`turn-batching.md` → "実装中の独立編集に効く合成コマンド") collapses: the reads go out in one turn, and the edits no longer wait on an interleaved read.
- Each present file is printed under a `===== <path> =====` header. **Under the Bash cap it prints every file; over it, a directive and no content** — the `doc:read` invariant — naming every path and telling the run to Read them **in one turn**, so the reads stay folded on the fallback too. A missing path is named on stderr and makes the call non-zero.

**Output / exit codes:** any missing path exits non-zero; an over-cap batch prints its directive and exits zero.

### `josh edit:files`

Apply several content-addressed edits from a plan in one call — the write-side counterpart of `read:files` (joshuafolkken/kit#2366).

```bash
pnpm josh edit:files plan.txt   # applies every block in the plan, one line per edit reporting the outcome
```

- **Why a command at all.** kit#2202 folded the pre-edit _reads_ and left the edits to native multiple `Edit` blocks, on the ground that presupposing a multi-edit tool would leave the rule unfired where the harness lacks one. kit#2366 measured that bet across six lanes — **230 of 230 edit turns issued a single `Edit`**, a per-turn density of exactly 1.000 — so native multiple edits never happened. A `pnpm josh` command runs on every harness, and a composite command is the only lever measured to move round-trip density (kit#2165 / kit#2162 / kit#2202), never advice.
- **The plan is a `=====`-fenced path header then a git-conflict-marker pair**, so a model authors it without escaping code into JSON. Several blocks may name one file:

  ```
  ===== scripts/a.ts =====
  <<<<<<< OLD
  const a = 1
  =======
  const a = 9
  >>>>>>> NEW
  ```

- **Each edit is content-addressed**: its `old` text must match exactly once — zero matches is `no match`, more than one is `ambiguous (N)` — so a false fold surfaces rather than corrupts, the same guarantee the `Edit` tool gives. A file is written **only when every one of its edits applied**, so a partial plan leaves the file untouched.
- **The batching guard hands it out.** On a run of single-call `Edit` turns the notice names the edits and offers `pnpm josh edit:files` over their files (`turn-batching.md` → "ガード発火時にも合成コマンドを手渡す"), the write-side of the read fold.

**Output / exit codes:** one line per edit (`applied` / `no match` / `ambiguous (N)` / `missing`); any non-`applied` edit, an unreadable plan, or a plan with no blocks exits non-zero.

### `josh time`

**Kit-only** — hidden from a consumer's `josh --help` and refused there with guidance; run it from the kit repository. Its CLI and run-state support live under the undistributed `scripts/time/`, while the runtime analysis the hooks, guards and `josh cost --over` rely on stays distributed under `scripts/time-runtime/`.

Report where a run's wall clock went, read from the same transcripts `josh cost` prices and, for the part no transcript records (CI, merge), from GitHub.

```bash
pnpm josh time                  # the last run tree, wall clock and cost by role
pnpm josh time --run            # the same run-tree scope, named explicitly
pnpm josh time --json           # the same figures, machine-readable
pnpm josh time --path <dir>     # read another project's transcripts from this checkout
```

**Options:**

- `--run` (default) — the whole run tree, wall clock led beside dollars. The additional report scopes (`--issue`/`--session`/`--epic`/`--last`/`--period`) and the `--instructions`/`--top` modifiers they carried were retired with no rule or decision reading them (#2017).
- `--path <dir>` — aim the read at another project (absolute path); keeps the `cwd` behavior when absent.
- `--json` — the run tree, machine-readable.

**Output:** the run-tree report `josh cost --run` builds — a header (session count, active wall clock, total dollars, run and merge counts, and counts of transcripts outside this run and unreadable ones), a by-role breakdown (cost and wall clock with their shares, session and request counts, preamble tokens), and a per-session list. When the run this checkout carries is unfinished, a run-state block (read from `run:carry` / `run:wake`) leads the report so a cut, handed-off or stalled run is surfaced at the front rather than buried. An unmeasured figure prints `not measured` rather than a zero.

**Output / exit codes:** an absent or untimed transcript exits non-zero and says where it looked.

### `josh retrospective`

**Kit-only** — hidden from a consumer's `josh --help` and refused there with guidance; run it from the kit repository. It reads kit's own development run — the transcript store, the review-finding ledger and the run event stream — so it means nothing in a consumer project.

Aggregate a finished run's four existing measurements into one digest, so the end-of-run retrospective has one place to read the run it just closed. It adds no new measurement.

```bash
pnpm josh retrospective          # the digest for the run this checkout carries
```

The run driver prints this at the stop position (`josh run:step`), once per invocation, when a run drains its backlog; a dispatched lane child never runs it. **What to file from the digest is `retrospective.md`'s** — this command only reads and shapes.

**Output:** four sections — the run tree's cost and time by role (flagging a role whose time share runs ahead of its cost share), the recurring review findings with their zero-finding denominator, the count of observation-ledger entries held, and the run's friction events (parks, outages, cuts, review rounds) — closed by a pointer to weigh them against `retrospective.md`.

### `josh eval`

**Kit-only** — hidden from a consumer's `josh --help` and refused there with guidance; run it from the kit repository.

Run the agent rule-compliance scenarios and report how many held.

```bash
pnpm josh eval                          # every scenario
pnpm josh eval consult-not-execute      # one scenario by name
JOSH_EVAL_MODEL=opus pnpm josh eval     # a different model (default: sonnet)
JOSH_EVAL_CONCURRENCY=2 pnpm josh eval  # fewer sessions at a time (default: 5)
```

Each scenario replays a situation against a real Claude session in a throwaway sandbox carrying the documents and skills kit distributes, then judges it on the tool calls the run made — never on what it said. The `n/m` line is a number you can compare before and after a document change. Needs the `claude` CLI on `PATH`; it is deliberately not part of CI. See [docs/eval.md](./eval.md) for the scenario format.

**Options:**

- `JOSH_EVAL_MODEL` — the model to run against (default `sonnet`).
- `JOSH_EVAL_CONCURRENCY` — how many sessions run at once (default `5`); a non-positive-integer value is refused.

**Output / exit codes:** exits `0` only when every scenario held. The last line is a verdict — `held`, `blocked`, `unmeasured` or `unreachable`; `blocked` stops a merge, the others are reported but do not. Three whole-suite runs ending on the same non-`held` verdict print a `Warning: N runs in a row…` line above the verdict.
