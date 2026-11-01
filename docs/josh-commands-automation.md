# josh CLI — Automation Command Reference

The commands a person rarely types: the ones Claude Code hooks, git hooks, the issue-driven workflow runs (`fullrun`, `backlogrun`, …) and lanes call, plus the `maintainer` commands kit's own maintainers run. Where each command came from: `docs/maintainers/josh-commands-automation-rationale.md` → "Where each command came from".

A `<!-- usage: … -->` span is generated — its summary line from the command's registry `description` and the rest from its `usage` (both in `scripts/josh/josh-commands-*.ts`), by `pnpm josh command:derive` — edit the entry, not the span.

## Development

These replace the corresponding `package.json` scripts; consumers need not add them.

### `josh refactor:scan`

<!-- usage: refactor:scan -->

List refactoring candidates in the changed scope by category and answer clear/candidates.

```bash
pnpm josh refactor:scan
```

<!-- /usage -->

The candidates are those of `prompts/refactoring.md` §4.1–§4.3, as `verdict: clear` / `verdict: candidates`. Completed scans exit zero; execution failures print a diagnostic and `verdict: error`, then exit non-zero.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh refactor:scan` in detail".

### `josh rename`

<!-- usage: rename -->

Rename an identifier, and the import specifier it moved with, across files through the TypeScript parse tree.

```bash
pnpm josh rename old_name new_name scripts/a.ts scripts/b.ts
pnpm josh rename lane_ledger lane_ledger_write --import '#scripts/lane/lane-ledger' '#scripts/lane/lane-ledger-write' scripts/gate/core-wait-record.ts   # the identifier and its module together
```

<!-- /usage -->

Only bindings and module specifiers change; strings, comments, `obj.old` and property keys stay. Each file's count is printed, then the files are formatted as the edit hook would.
A file with no replacement, missing, or not TypeScript or JavaScript is named, nothing is written, exit 1.

### `josh format:edited`

<!-- usage: format:edited -->

Claude Code hook: format the file just edited (reads the tool call on stdin).

```bash
pnpm josh format:edited   # run by the PostToolUse hook, the tool call as JSON on stdin
```

<!-- /usage -->

`.claude/settings.json` wires it to `PostToolUse`. It reads `tool_input.file_path` and runs `eslint --fix` then `prettier --write` on that path alone.

```json
"PostToolUse": [
	{
		"matcher": "Edit|Write|Bash",
		"hooks": [{ "type": "command", "command": "pnpm josh format:edited", "timeout": 90 }]
	}
]
```

- eslint (warm `eslint_d`, cache `.eslintcache.edit`), then prettier. Never fails; skips `node_modules` / `.git` at any depth, `dist` / `build` at top level.
- Carries a density line via `hookSpecificOutput.additionalContext` under set conditions.
- **Reports the problems `eslint --fix` could not fix** — file, `line:col` and rule — on the same `additionalContext`, never failing the edit.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh format:edited` in detail".

### `josh pretool:guard`

<!-- usage: pretool:guard -->

Claude Code hook: the batch, investigation and rule guards in one process (reads the tool call on stdin).

```bash
pnpm josh pretool:guard   # run by the PreToolUse hook, the pending tool call as JSON on stdin
```

<!-- /usage -->

It also runs the duplicate-read guard. A refusal leaves through `hookSpecificOutput.permissionDecision`; a call no guard claims writes nothing.

Only a launcher-assigned `worker` may edit source. Other roles retain explicit record writes and
recognized reads/operations; unverified shell or patch inputs are refused on every attempt.

**How each guard behaves in a dispatched lane child is an enumeration** in `scripts/lane/lane-guard-policy.ts` — `refuse`, `notice` or `off` per guard; `lane-guard-policy.test.ts` pins it to the guards' live behavior.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh pretool:guard` in detail".

```json
"PreToolUse": [
	{
		"matcher": "Bash|Edit|Read|Write|AskUserQuestion|Agent|Task|Glob|Grep|WebFetch",
		"hooks": [
			{
				"type": "command",
				"command": "<project-root prefix> sh scripts/hooks/run-hook.sh pretool-guard",
				"timeout": 20
			}
		]
	}
]
```

Every kit hook command, Claude Code and Codex alike, has this shape (`scripts/init/hook-launch.ts`):

- **`<project-root prefix>`** — `cd`s to `CLAUDE_PROJECT_DIR`, else (Codex) `git rev-parse --show-toplevel`, so a hook run in a subdirectory finds its paths. It exports the launch directory as `JOSH_HOOK_CWD`, from which the launcher moves into a Claude Code worktree (`.claude/worktrees/<name>`).
- **The launcher** (`scripts/hooks/run-hook.sh <name>`) clears a git hook's location variables when git resolves without them, then runs the ready gate, falling back to `pnpm josh <command>`.
- **The ready gate** (`tools/hooks/hook-bundle-ready.ts`) runs the bundle when its digest matches the source, and when stale runs the old build once while a background rebuild replaces it (in-process only when no whole build exists).
- A consumer's command is rewritten to the installed launcher (`node_modules/@joshuafolkken/kit/scripts/hooks/run-hook.sh`), whose gate is a presence check on `dist/hooks/` (published bundles have no source to be stale against) and whose fallback is the `dist/josh.js` dispatcher.

#### The batching guard

- The batch guard reaches `Bash`, `Edit`, `Read`, `Write`, `Glob`, `Grep`, `WebFetch`; `AskUserQuestion`, `Agent` and `Task` in the matcher are the rule guard's. All but `Write` (a notice only) are refusable. Refused only when two single-call turns are closed behind it, the call is bundleable, and it touches nothing the sequence already touched.
- **In a dispatched lane child** (`JOSH_LANE_CHILD`): off, except a chain of single-call `grep` / `rg` / `find` / `fd` / read-only `sed` searches, which the `search-batching` row refuses unless the investigation guard refuses the same call (`scripts/lane/lane-guard-policy.ts`). Why: `docs/maintainers/josh-commands-automation-rationale.md` → "The batching guard is off in a lane child".
- **Fires more than once per run**: again every `REFIRE_EVERY` further single-call turns (the notice every `NOTICE_REFIRE_EVERY`); a batched turn starts a fresh sequence.
- Set `JOSH_BATCH_GUARD` to `off` / `0` / `false` / `no` to disable.

### `josh time:density`

<!-- usage: time:density -->

Report tool calls per round trip across the recent lane sessions.

```bash
pnpm josh time:density
pnpm josh time:density --lanes 5   # the five most recent lanes
```

**Options:**

- `--lanes <n>` — average over a different count of recent qualifying lanes (default 10).
- `--path <dir>` — read another project's lane transcripts, as `josh time` does. Run from a lane, it reads its main checkout's lanes.

<!-- /usage -->

Kit-only.

```
lanes=10 round_trips=505 tools/turn=1.23 batched=79/505 independent=50 dependent=46
independent by kind: Bash: grep=19, Bash: sed=9, Write=6, Bash: cat=5, Edit=4
```

- `tools/turn` (floor 1.5) runs a little above the Issue's per-assistant-message frame (1.04), whose denominator also counts text-only turns. Use it as a behavior-change Issue's baseline for `josh measure:rerun`.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh time:density` in detail".

#### The investigation guard

Refuses a read once the unedited-read threshold is reached again. The threshold counts un-edited files read since the run's last delegated unit.

Matcher `Read|Bash`, timeout 20.

- On the `Bash` side only read-only lines are refused (`bat`, `cat`, `head`, `less`, `more`, `nl`, `sed`, `tail`); a delegation clears the pending set.
- **Search turns count too** (`fd`, `find`, `grep`, `rg`): the third search turn since the last delegation or successful write is refused, parallel searches in one turn counting once. Every read-only search counts, the run's own instructions included.
- The refusal points at the `investigator` agent (`.claude/agents/investigator.md`, shipped as `kit:investigator`): `model: sonnet`, `effort: low`, read-only tools. Excludes the run's own instructions (`CLAUDE.md`, `prompts/`, `.claude/skills/`) and harness session files.
- **A refusal in a dispatched lane child too** (`JOSH_LANE_CHILD`). Why: `docs/maintainers/josh-commands-automation-rationale.md` → "The investigation guard refuses in a lane child".
- Set `JOSH_INVESTIGATION_GUARD` to `off` / `0` / `false` / `no` to disable.

#### The duplicate-read guard

Refuses a second whole-file read of a path whose content has not changed since the run last read it. It is composed in `pretool:guard` alongside the batch, investigation and rule guards, not a separate `PreToolUse` entry.

- The transcript gives when the path was last read; the file's `mtime` says whether it changed since. A file whose `mtime` predates that read is refused; anything that moves the `mtime` (edit, merge, background growth) lets it through.
- A read carrying an `offset` or `limit` is never refused. A failed stat (deleted or unreadable file) allows the call.
- One refusal per accumulation: a run reading on anyway is not refused again, and the refusal re-arms when a fresh successful read of the target lands — the same shape as the investigation guard.
- **In a dispatched lane child it is a `notice`, not a refusal** (`JOSH_LANE_CHILD`). See the `pretool:guard` lane-child enumeration above.
- Set `JOSH_DUPLICATE_READ_GUARD` to `off` / `0` / `false` / `no` to disable.

#### The rule guard

Delivers a trigger-delivered rule at the call that binds it, in place of a rule resident in `CLAUDE.md` (`pnpm josh rule:list` prints every row).

`scripts/rules/delivered-rules.ts` holds one row per relocated rule — an id, the trigger, and the refusal text.

**The rules it delivers today:**

- **Direct filing** — trigger is a hand-built filing (`gh issue create`, or a `title`-bearing POST to a path ending `/issues`); refused on every occurrence, pointed at [`josh issue:file`](josh-commands-backlog.md#josh-issuefile).
- **Issue comments** — trigger reads an Issue body without them (`gh issue view <N>`, or a `GET` ending `…/issues/<N>`); hands over `gh issue view <N> --comments`.
- **Piped verification** — trigger is a check (`gate`, `check*`, `lint*`, `cspell*`, `test*`, `eval`, `overrides`, `ranges`) standing anywhere but the last pipeline segment.
- **Early heartbeat** — trigger is a `Bash` call whose whole purpose is to wait; `pnpm josh run:progress --once` / `--wait` are exempt.
- **The pre-gate cut row** — trigger is a `Bash` call running `pnpm josh gate` from a **lane** working tree that **has not yet taken its cut**; hands over `pnpm josh run:cut <N>` with what each of its six verdicts obliges. It exists because the step, carried as prose, fired **0 times in 6 lane children**. `--resume`, `--end` and `--json` do not count as taking the cut. Procedure: `.claude/skills/workflow-commands/pre-gate-cut.md`.
- **The implementation-phase cut row** — an `Edit` / `Write` from a lane that has not taken its cut, once `pnpm josh cost --cut` is over the shared threshold; hands over `pnpm josh run:cut --impl <N> --handoff <path>` on every threshold crossing.
- **Bare `pnpm josh git`** — trigger is a `pnpm josh git` with no `-y` / `--yes` (it prompts, and cancels with no TTY); hands over `pnpm josh git -y "<title> #<N>"` on every occurrence. Disjoint from the run-tail push row, which requires `-y`.

Set `JOSH_RULE_GUARD` to `off` / `0` / `false` / `no` to disable. Some rows deliver once per run, some on every occurrence, and some refuse until an earlier command has run.

### `josh rule:list`

<!-- usage: rule:list -->

Print the trigger-delivered rules — each one's source, firing call and silent turn — from the guard rows.

```bash
pnpm josh rule:list   # print every trigger-delivered rule
```

<!-- /usage -->

The rules `rule-delivery.md` points at: one item per guard row of `scripts/rules/delivered-rules.ts`, then the `Stop` hook's rows. The prose is each row's own `about` field (the `Stop` rows' in `scripts/rules/stop-rule-rows.ts`), so a row cannot be added without it. A hookless agent reads it as its checklist.

### `josh codex:hook-adapter`

<!-- usage: codex:hook-adapter -->

Codex hook: run the pretool or posttool guard on a Codex payload (reads the tool call on stdin).

```bash
pnpm josh codex:hook-adapter pretool    # a Codex PreToolUse payload on stdin
pnpm josh codex:hook-adapter posttool   # a Codex PostToolUse payload on stdin
```

<!-- /usage -->

It answers in Codex's hook format. `.codex/hooks.json` launches it as `sh scripts/hooks/run-hook.sh codex-hook-adapter <pretool|posttool>`; this command is the fallback when the bundle cannot run.

The adapter normalizes patch and shell calls into the same authority check. Opaque orchestration is
refused for non-workers. Hosts that skip PreToolUse, including nested tool calls, have no verified
enforcement; generated settings alone do not establish host coverage.

### `josh stop:guard`

<!-- usage: stop:guard -->

Claude Code Stop hook: send the hold notify and release the hold itself; block on the rules that need the model (reads the Stop payload on stdin).

```bash
pnpm josh stop:guard   # run by the Stop hook, the stop payload as JSON on stdin
```

<!-- /usage -->

A failed step of its own blocks too. The rows are in `prompts/collaboration-workflow/rule-delivery.md`.

`backlogrun`'s parent loop and next-issue fetch belong to the supervisor, so `stop:guard` does not count that fetch toward a block. A named epic handed to a headless session for a decision keeps the lane-child wait protection. Stall and leftover detection runs at the `Stop` event.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh stop:guard` in detail".

### `josh session:lang`

<!-- usage: session:lang -->

Claude Code hook: print a non-default JOSH_SESSION_LANG for the session context, and the run:board reply rule while a backlogrun is live (otherwise nothing).

```bash
pnpm josh session:lang   # run by the UserPromptSubmit hook; `ja` prints nothing
```

<!-- /usage -->

- Timeout 10. Read via `process.loadEnvFile` (environment wins). Unset / empty / no-`.env` resolve to `ja`; `JOSH_SESSION_LANG=en` opts into English.
- While a `backlogrun` is live in the repository, it prints one line telling the session to answer a progress question with `pnpm josh run:board --chat`, even a session not driving the run.

### `josh e2e:retry-check`

<!-- usage: e2e:retry-check -->

Report whether the preview server crashed during a failed E2E attempt (CI).

```bash
pnpm josh e2e:retry-check
```

<!-- /usage -->

Run by the distributed `ci.yml` between its E2E attempts.

- Reads the preview server debug log (`WRANGLER_LOG_PATH`, default `e2e-web-server-logs`); matches only when `Error in ProxyController` **and** `Network connection lost.` are in the same file. Verdict goes to `$GITHUB_OUTPUT` as `crashed`; a missing/unreadable log means "no crash".

### `josh test:reach`

<!-- usage: test:reach -->

Print how many test files each file's imports reach — the count test:related sizes its claim by — one '<count> <file>' line per file.

```bash
pnpm josh test:reach scripts/lane/lane-ledger.ts   # a reach count to measure before and after a change
```

<!-- /usage -->

Run by a lane filing an overrun investigation, for the reach count its `## ベースライン` measures before and after a change.

- A path is read from the repository root (where `pnpm josh` runs) or as an absolute path; one that names no file is refused rather than printed as `0`.

## Project

Commands for setting up and maintaining a project.

### `josh sync:scope`

<!-- usage: sync:scope -->

Say whether this change touches a file josh sync distributes.

```bash
pnpm josh sync:scope            # the branch diff
pnpm josh sync:scope --staged   # the staged diff instead
pnpm josh sync:scope --json     # {"scope":"managed","reason":"..."}
```

**Options:**

- `--staged` — inspect the staged diff instead of the branch diff.
- `--json` — emit `{"scope","reason"}` as JSON.

<!-- /usage -->

**Output / exit codes:** the answer (`managed` or `clean`) goes to stdout, the reason to stderr. Exit status is `0` for both.

### `josh dogfood:commit`

<!-- usage: dogfood:commit -->

Make the first commit of a dogfood run's own kit-test-* project.

```bash
pnpm josh dogfood:commit ~/Development/kit-test-html-start
```

<!-- /usage -->

Kit-only.

An agent's own `git add` / `git commit` is refused wherever it points (the index guard cannot tell a throwaway project from the user's work), so this is the sanctioned route. It runs `git init --initial-branch=main` when the directory has no `.git`, stages everything, commits `Initial commit` and names the branch `main`.

It refuses, changing nothing and exiting `1`, unless the directory:

- is named `kit-test-*` and exists;
- lies outside the kit checkout it is run from;
- has no commit yet, and is not inside another git repository — a `.git` without history, as `sv create` leaves, is accepted.

### `josh fresh:run`

<!-- usage: fresh:run -->

Run an install scenario in a Docker container of a machine with nothing installed, and keep the log.

```bash
pnpm josh fresh:run --list                        # kit's six patterns
pnpm josh fresh:run kit-test-html-init            # one pattern, the packed checkout
pnpm josh fresh:run kit-test-html-start           # a GitHub pattern, the latest published version
pnpm josh fresh:run --spec fresh/html-init.json   # a scenario another toolkit wrote
```

**Options:**

- `--list` — print the pattern names and run nothing.
- `--spec <file.json>` — run the scenario in this file instead of a named pattern; the path is relative to the project root.
- `--package-version <version>` — the published version a `package_source: published` scenario installs. Default: the registry's latest version of the package the command is run from.
- `--log-dir <dir>` — where the log is written. Default: `.josh/tmp/fresh-machine`.
- `--rebuild` — build the machine image without the layer cache.

<!-- /usage -->

Needs Docker.

**Output / exit codes:** the session is written to `<log-dir>/<scenario>-<n>.log`, whose path is the last line. The exit status is the container's; a setup problem exits `1`.

A GitHub scenario creates a real private repository named after the run; none is deleted. The scenario format, the patterns and the token handling: [maintainers/fresh-machine.md](./maintainers/fresh-machine.md).

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh fresh:run` in detail".

### `josh auth:setup`

<!-- usage: auth:setup -->

Save the long-lived Claude Code token `claude setup-token` prints in the macOS keychain, for josh fresh:run.

```bash
pnpm josh auth:setup           # sign in and save the token
pnpm josh auth:setup --check   # ok: … saved on <date>, or missing: … and exit 1
```

<!-- /usage -->

`claude setup-token` is a browser sign-in; the token is never shown and never in a file. It serves `fresh:run`'s `requires_claude` scenarios.

**Exit codes:** `0` once saved; `1` on no token or no keychain (then set `CLAUDE_CODE_OAUTH_TOKEN`). Full handling: [maintainers/fresh-machine.md](./maintainers/fresh-machine.md#claude-code).

### `josh sonar:hotspots`

<!-- usage: sonar:hotspots -->

Fetch SonarCloud hotspots on a pull request and print each one's Step B disposition.

```bash
pnpm josh sonar:hotspots 42
```

<!-- /usage -->

The branch is `excluded` / `local` / `fix` / `defer`; a failed read prints `unreadable`, distinct from none found. The project key comes from `sonar-project.properties` and the upstream-synced branch key from `sync:scope`'s own detection. Full handling: `prompts/sonar-hotspot-handling.md`.

### `josh sonar:new-code`

<!-- usage: sonar:new-code -->

Fail when a pull request adds any new SonarCloud issue or duplicated block.

```bash
pnpm josh sonar:new-code 42
```

<!-- /usage -->

It prints `clean` (exit `0`), `findings: …` or `unreadable: …` (exit `1`).

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh sonar:new-code` in detail".

### `josh ui:routes`

<!-- usage: ui:routes -->

List the screenshot-target routes the current change touches.

```bash
pnpm josh ui:routes            # the branch diff
pnpm josh ui:routes --staged   # the staged diff instead
```

<!-- /usage -->

A changed `+page` / `+layout` gives its own route, a changed shared component the routes that import it (a one-level `src/routes` scan). Empty output prints "no route derived"; `verify-ui` §1 narrows the list.

### `josh ui:shot`

<!-- usage: ui:shot -->

Capture routes with this project's own screenshot command.

```bash
pnpm josh ui:shot / /blog
```

<!-- /usage -->

It runs the first of `josh-app shot`, `josh-game shot` (listed in the toolkit's usage line) and a `shot` / `screenshot` / `verify:ui` script with the routes; that command prints the image paths and its exit status is the result. Nothing resolved prints the candidates tried and exits `1`.

### `josh propagate`

<!-- usage: propagate -->

Carry the published release into every consumer repository next to this one.

```bash
pnpm josh propagate
pnpm josh propagate --dry-run             # report targets and steps, write nothing
pnpm josh propagate --skip-publish-wait   # release already known to be published
pnpm josh propagate --target app-kit      # carry the release into one consumer only
```

**Options:**

- `--dry-run` — report targets and steps without writing; skips the publish wait, opens no issues.
- `--skip-publish-wait` — skip the registry poll for an already-published release.
- `--target <repo>` — process only that consumer (`app-kit` or `joshuafolkken/app-kit`); the rest are reported `skipped` and left untouched. An unknown, ambiguous or non-dependent name fails before the publish wait, writing nothing.

<!-- /usage -->

It runs only from the clean, up-to-date default branch of kit or a CLI-shipping toolkit (app-kit, game-kit), and waits for the exact published version in the registry before touching any consumer.

Staged delivery: kit → app-kit → joshuafolkken-com / game-kit → waneccha. A toolkit also carries its base packages, pinned to its installed versions. Each consumer is delivered by the topmost toolkit it installs; lower runs report it `skipped`, naming that toolkit.

Per consumer, in order: working-tree check, `pnpm add -D <package>@<version>` per carried package, `pnpm <bin> sync` per carried package (base first), verification gate, open upgrade issue, `pnpm josh git`, return to default branch. One consumer's failure never stops another; each is reported `propagated`, `failed` (step, reason, what it left behind) or `skipped`.

The opposite direction — one consumer catching itself up from its own checkout — is [`josh adopt`](josh-commands.md#josh-adopt).

## Workflow

AI-assisted git and notification helpers used in the day-to-day development loop.

### `josh pr:classification`

<!-- usage: pr:classification -->

Require one release classification on a pull request.

```bash
pnpm josh pr:classification   # run by CI on a pull request; fails without one label
```

<!-- /usage -->

The label is one from the PR template; bots may omit it. Label changes rerun only the `Release classification` workflow (`.github/workflows/pr-classification.yml`), never CI.

### `josh followup`

<!-- usage: followup -->

Follow-up git workflow.

```bash
pnpm josh followup "PR title #N"                                                 # merges (default)
pnpm josh followup "PR title #N" --notify-message "Implemented X:\n- change 1"
pnpm josh followup "PR title #N" --notify-message-file completion.md
pnpm josh followup "PR title #N" --ai-review-ignore-reason "false positive"
pnpm josh followup "PR title #N" --no-merge                                      # do the work, leave the PR open
```

**Options:**

- `--no-merge` — do the follow-up work but do not merge; leaves the PR open (the only flag that stops the merge). `--merge` is a deprecated no-op. A PR already merged by hand skips the CI wait, the AI-review scan and the merge and runs only the post-merge tail; a completion report already on the Issue is not posted again.
- `--notify-message` — inline completion body; `\n` expands to newlines.
- `--notify-message-file` — read the completion body from a file (`-` reads stdin); use this whenever the body carries a backtick or `$`. Passing both forms is refused.
- `--ai-review-ignore-reason` — reason to dismiss an AI-review finding.

<!-- /usage -->

**Live-execution evidence:** a merge is refused when the branch changes a runtime path (`josh test:declared`'s classification) and the PR body lacks a `## 実機証跡` section of a backticked command plus its fenced output (`issue:lint`'s `## 再現` parser). Pass it with `josh git -y --body-file <path>`.

**Acceptance-criteria map:** the Issue is re-read just before the merge. A merge is refused when an acceptance criterion has no row under the PR body's `## 受け入れ条件の対応`, or a deferral row names an issue that does not exist.

Rows match by an identifier built from the criterion's text, so a reworded criterion has no row. No acceptance section merges as before. `josh pr` writes a pending row per criterion; format: `prompts/collaboration-workflow/report-format.md` → "PR 本文の受け入れ条件の対応表".

**Behavior:** waits for CI (every 10 s, a 32-minute budget, `JOSH_CI_TIMEOUT_SECONDS`), merges, then closes completed epics and the Issue, removes `in-progress` and flushes the ledger. A person's unacknowledged update stops it unmerged ([`josh issue:ack`](josh-commands-backlog.md#josh-issueack)). Give the call its longest timeout.

**Check report:** a green run's completion notification lists under `Checks:` each failed check left in the green snapshot (`required` / `not required`), each job re-run as flaky and each retriggered rate-limited CodeRabbit review. A red run or a merged-PR re-run writes no list; `--notify-message` names its failures.

**Output / exit codes:** exits non-zero naming the failing check on a red run; prints a per-stage timing block (`followup stage: <name> <n> s`) on both success and failure.

Related: [`josh git`](josh-commands.md#josh-git), [`josh observations:flush`](#josh-observationsflush), [`josh time`](josh-commands-run.md#josh-time).

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh followup` in detail".

### `josh notify`

<!-- usage: notify -->

Send Telegram notification.

```bash
pnpm josh notify --task-type planning --issue-url "https://..." --body="- bullet 1\n- bullet 2"
pnpm josh notify --task-type confirmation --issue-url "https://..." --body-file r.md --recommended "Go" --alternative "Wait"
```

**Options:**

- `--task-type` — one of `planning` 📋, `completion` ✅, `failure` ❌, `warning` ⚠️, `kickoff_retry` 🔄, `confirmation` ⏸️. Do not send `completion` or `warning` by hand — `josh followup` sends them.
- `--body` / `--body=$'…'` — inline body; use `--body=$'…'` when it starts with `-`.
- `--body-file` — read the body from a file (`-` reads stdin); use this whenever the body carries a backtick or `$`. Passing both forms is refused.
- `--repo-name` / `--issue-url` / `--pr-url` — header repository, resolved in that order, then the working directory. The issue title is read from `--issue-url`.
- `--recommended` / `--alternative` — the choices appended under `JOSH_SESSION_LANG` headings; `--recommended` is required for `confirmation`, `--alternative` is repeatable.

<!-- /usage -->

**Output / exit codes:** a send that reached nobody exits non-zero. `planning` / `completion` skip unless [`JOSH_NOTIFY_OPT_IN`](environment-variables.md#notification-behavior) names them. Needs `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, or `JOSH_NOTIFY=off`.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh notify` in detail".

### `josh observations:flush`

<!-- usage: observations:flush -->

Commit the observation ledger as a pull request of its own, and merge it.

```bash
pnpm josh observations:flush
```

<!-- /usage -->

It commits only the ledger lines (`.josh/observations/`) no run's own commit carried — lines written outside any run.

It first carries the closed issues' comment rounds no lane carries into `<N>-comment-rounds.md`, in the same pull request.

**Behavior:** refused off the default branch or beside any other change; prints `clean` when there is nothing to commit. `pnpm josh run:tail` runs it after a merge.

Related: [`josh followup`](#josh-followup).

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh observations:flush` in detail".

### `josh measure:rerun`

<!-- usage: measure:rerun -->

Re-run a merged issue’s baseline command and print the before/after pair.

```bash
pnpm josh measure:rerun 2212
```

<!-- /usage -->

Reads the Issue's `## ベースライン` section and runs each `` `<command>` → <value> `` entry.

**Trust:** a baseline is shell, so it runs only for an `OWNER` / `MEMBER` / `COLLABORATOR` author; any other author, or an unreadable issue, exits 1 before any command runs. A command over its one-minute budget prints `(command failed: …)`; the rest still run.

**Behavior:** a value that has not moved records the rule's premise as refuted — one line in `.josh/observations/`. A prose measurement is refused.

Related: [`josh observations:flush`](#josh-observationsflush), [`josh issue:lint`](josh-commands-backlog.md#josh-issuelint).

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh measure:rerun` in detail".

### `josh observation:record`

<!-- usage: observation:record -->

Record an observation sighting and answer whether it is now filed.

```bash
pnpm josh observation:record flaky-e2e d1 'tests/e2e/login.test.ts' 'times out on CI only'
pnpm josh observation:record flaky-e2e d1 'src/app.ts' 'fails there too' --checkout ~/Development/app   # another repository's ledger
```

**Options:**

- `--checkout <path>` — count and append in that repository's `.josh/observations/` instead.

<!-- /usage -->

It counts the `- k:<key>` sightings across `.josh/observations/`, appends this one, and prints `file` (the second sighting) or `ledger`; earlier sightings go to stderr. A malformed or `k:example` line is refused with exit 1. The rule: `.claude/skills/workflow-commands/observation-ledger.md`.

### `josh review:record`

<!-- usage: review:record -->

Record a review round’s findings, or check a round was recorded.

```bash
pnpm josh review:record --issue 2325 bug-risks:medium:src/foo.ts:42 tests:low:a.test.ts
pnpm josh review:record --issue 2325                                                      # a zero-finding round — records one `none` line
pnpm josh review:record --issue 2325 --comment                                            # a round that passed after the PR opened — an Issue comment, no append
pnpm josh review:record --check --issue 2325                                              # the merge gate: was it recorded?
pnpm josh review:record --issue 2325 --interaction                                        # the interaction review’s pass — a `- ri:` line
pnpm josh review:record --from-slot --issue 2325 2=filed:#7                               # the findings the reviewer wrote with review:submit — each `fixed` unless its line is given another
```

<!-- /usage -->

The findings are a `/code-review` round's, written as `- rf:` lines in the issue's ledger file (`.josh/observations/<N>.md`) — the one write path for findings. Each code round opens with a `- rb:<date> | #<N>` boundary line, so [`josh review:round2`](josh-commands-backlog.md#josh-reviewround2) reads only the latest round's lines.

`--from-slot` records the findings written with [`josh review:submit`](josh-commands-run.md#josh-reviewsubmit) (`--interaction`: that slot's), each `fixed` unless a positional `<n>=<disposition>` names another for its 1-based line. An unwritten slot or an `<n>` past the last line is refused.

**Behavior:** each positional is `'<category>:<severity>:<file>[ — <reason>]'` (quoted).

A ledger round carries the closed issues' comment rounds into its commit, except in a lane child, which leaves them to [`josh observations:flush`](#josh-observationsflush).

**`--check --issue <N>` is the merge gate** [`josh followup`](#josh-followup) runs: a `- rf:` line for the issue is `ok`, its absence is `missing`, no ledger `not-required`.

Related: [`josh review:findings`](josh-commands.md#josh-reviewfindings), [`josh observations:flush`](#josh-observationsflush).

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh review:record` in detail".

## Versioning

### `josh bump`

<!-- usage: bump -->

Bump package version.

```bash
pnpm josh bump major
pnpm josh bump minor
pnpm josh bump patch
```

<!-- /usage -->

It edits the version in `package.json`. Not part of the child flow; `josh release` raises the version.

After bumping, update `docs/` to reflect any behavior changes before committing.

### `josh release`

<!-- usage: release -->

Release the merges main has taken since the version last changed.

```bash
pnpm josh release
pnpm josh release --dry-run   # count and report, write nothing
```

**Options:**

- `--dry-run` — count and report only; writes nothing, fetches nothing, and creates no work tree.
- `--help` / `-h` — print the usage line and exit 0 without fetching or releasing. Any other argument is refused with the usage line and a non-zero exit, before anything is fetched.

<!-- /usage -->

It raises the version by one minor per merge, opens and merges a `release/v<version>` pull request, then waits for the tag, npm publish and GitHub Release, one line per stage:

```text
📝 Release PR opened: https://github.com/<owner>/<repo>/pull/<N>
🔀 Release PR merged: https://github.com/<owner>/<repo>/pull/<N>
🏷 Tag vX.Y.Z created
📦 Published to npm: https://www.npmjs.com/package/<name>/v/X.Y.Z
📰 GitHub Release created: https://github.com/<owner>/<repo>/releases/tag/vX.Y.Z
🎉 Release vX.Y.Z complete
```

A `private: true` package skips the npm stage.

**Runs in its own work tree, never the root checkout**, so it can run beside a [`backlogrun`](how-to/run-issues.md) on a dirty root.

Watch budgets (default 30 minutes each): `JOSH_RELEASE_TAG_TIMEOUT_SECONDS` (tag), `JOSH_RELEASE_NPM_TIMEOUT_SECONDS` (npm publish), `JOSH_RELEASE_GITHUB_RELEASE_TIMEOUT_SECONDS` (GitHub Release).

**Output / exit codes:** exits 0 and writes nothing when the pending count is zero; exits non-zero if `origin/<default>` cannot be read, no version base is found, `release/v<version>` already exists (locally or on origin), or a watched stage never appears (printed with ❌).

The npm watch stops early when the tag's `Publish` run fails; its ❌ line names the run ID.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh release` in detail".

### `josh release:scope`

<!-- usage: release:scope -->

Say whether a release is owed, from the unreleased merges on main.

```bash
pnpm josh release:scope          # → required | skip | unknown
pnpm josh release:scope --json   # {"scope":"…","reason":"…"} on one line
```

<!-- /usage -->

Same fetch-then-count as `josh followup`: `required` when main has taken at least one merge since the version last changed, `skip` when the count is zero, `unknown` when it could not be read.

**Output / exit codes:** the verdict goes to stdout, the reason to stderr. Exit code is 0 for every verdict and 1 only for an unknown flag; `unknown` is never read as `skip`.

### `josh release:github`

<!-- usage: release:github -->

Create the GitHub Release for a published tag, with generated notes.

```bash
pnpm josh release:github   # run by CI with GH_TOKEN, RELEASE_TAG and GITHUB_REPOSITORY set
```

<!-- /usage -->

The notes come from `.github/release.yml`. Run by CI — kit's `publish.yml`, and the `github-release.yml` every consumer receives.

It takes no arguments: `--help` / `-h` prints the usage line and exits 0 without reading the environment; any other argument is refused with the usage line and a non-zero exit, before anything is released.

| Environment             | Meaning                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `GH_TOKEN`              | Token with `contents: write` and `actions: read`. Required                              |
| `RELEASE_TAG`           | The tag to release. Required                                                            |
| `GITHUB_REPOSITORY`     | `owner/repo`, set by GitHub Actions. Required                                           |
| `RELEASE_START_TAG`     | Last tag before automatic releases. Unset: latest release; none: nearest lower tag      |
| `RELEASE_WORKFLOW`      | Publish workflow whose failed run for a lower tag skips it. Unset: wait for its release |
| `RELEASE_JOBS`          | Jobs in that workflow whose failure counts. Unset: any failed job                       |
| `RELEASE_AWAIT_PUBLISH` | `true`: wait for the tag's `Publish <tag>` run in `RELEASE_WORKFLOW`; skip on failure   |
| `RELEASE_RUN_WORKFLOW`  | Workflow whose run creates a tag's release (`RELEASE_WORKFLOW` if it does). Unset: wait |

Releases are created in version order: a later tag waits for the nearest lower one, skipping one whose publication failed.

**Output / exit codes:** prints `published <tag> from <baseline>` or `already-published`; exits non-zero on an API error, an invalid tag or repository, a latest release that is not older than the tag, or a lower tag that never gets a release within the wait budget.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh release:github` in detail".

## Maintenance

### `josh ruleset:check`

<!-- usage: ruleset:check -->

Check that the default branch requires every status check kit's workflows report (--apply adds the missing ones).

```bash
pnpm josh ruleset:check           # report only
pnpm josh ruleset:check --apply   # add the missing checks to the existing rule
```

**Options:**

- `--apply` — append the missing checks to the ruleset's required-checks rule (or to the branch protection's contexts). It never creates a ruleset: with none, create one under Settings → Rules → Rulesets, then rerun. Writing a repository setting needs admin access, so only this flag writes — `josh sync` and `josh doctor` never do.

<!-- /usage -->

A distributed workflow's check gates nothing until the repository requires it. It reads the default branch's rules — rulesets first, classic branch protection when no ruleset requires a check — and compares them with the checks of the distributed workflows the repository has:

- `.github/workflows/ci.yml` — `Checks`, `Detect E2E`, `E2E`, `Secret Scan`, `Security Audit`
- `.github/workflows/sonar-qube.yml` — `SonarQube`
- `.github/workflows/pr-classification.yml` — `Release classification`

A workflow the repository does not have contributes nothing. `E2E` is safe to require without an E2E suite: the job is skipped, and a skipped required check passes. Checks required beyond these are left alone.

It exits `0` when every expected check is required and `1` when one is missing, nothing requires checks at all, or the rules could not be read (a failed read is never reported as missing).

### `josh audit:provision`

<!-- usage: audit:provision -->

Install the pinned osv-scanner when the audit cannot find one (no-op if present).

```bash
pnpm josh audit:provision           # no-op if a scanner is already present
pnpm josh audit:provision --force   # ignore backoff, allow a longer download
```

**Options:**

- `--force` — ignore the 6-hour failure backoff and allow a longer download window; the command to run after fixing a network problem.

<!-- /usage -->

Wired to the `SessionStart` hook of the distributed `.claude/settings.json`.

**Output / exit codes:** the version is pinned and its SHA256 verified before install. Any failure (network, non-OK response, checksum mismatch, no published build) is reported and exits `0`; the missing scanner surfaces at the pre-push audit.

### `josh lockfile:policy`

<!-- usage: lockfile:policy -->

Verify the lockfile against pnpm's supply-chain policy (minimumReleaseAge) when it or the policy moved from the merge-base.

```bash
pnpm josh lockfile:policy   # verify when the lockfile or its policy moved
```

<!-- /usage -->

It uses pnpm's own check, which `trustLockfile: true` skips on install. The gate's `lockfile` check; kit's own.

**Output / exit codes:** silent `0` when neither `pnpm-lock.yaml` nor `pnpm-workspace.yaml` moved from the merge-base; otherwise pnpm's verdict (about a minute).

### `josh reconcile-templates`

<!-- usage: reconcile-templates -->

Record template source hashes (--check to verify drift).

```bash
pnpm josh reconcile-templates           # regenerate copy templates + record tripwire hashes
pnpm josh reconcile-templates --check   # verify templates are in sync; non-zero on drift
```

**Options:**

- `--check` — verify only; exits non-zero on drift. A pre-commit hook runs this when a tracked source or copy template is staged.

<!-- /usage -->

**Copy pairs** are byte-for-byte copies regenerated automatically (`.gitignore` → `templates/gitignore`); **tripwire pairs** intentionally diverge and only force a conscious review via a recorded hash (`sonar-project.properties` → `templates/sonar-project.properties`).

Tripwire hashes live in `.template-source-manifest.json` (kit-internal, not distributed).

### `josh latest:scope`

<!-- usage: latest:scope -->

Say whether this run has to update dependencies, from when josh latest last finished (--record notes a run).

```bash
pnpm josh latest:scope            # required or skip, the reason on stderr
pnpm josh latest:scope --record   # note a finished josh latest run
pnpm josh latest:scope --json     # the verdict and the reason as JSON
```

**Options:**

- `--record` — write the completion record `josh latest` ends with.
- `--json` — emit the verdict and its reason as JSON.

<!-- /usage -->

A completion record younger than **12 hours** (`JOSH_LATEST_MAX_AGE_HOURS`) answers `skip`.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh latest:scope` in detail".

### `josh latest:if-required`

<!-- usage: latest:if-required -->

Run josh latest only when latest:scope answers required, stashing around it.

```bash
pnpm josh latest:if-required   # stash, update, pop on required
```

<!-- /usage -->

### `josh latest:guard`

<!-- usage: latest:guard -->

Refuse josh latest inside a lane (the update stamp is keyed to the project root).

```bash
pnpm josh latest:guard   # refuses inside a lane
```

<!-- /usage -->

It fronts the `josh latest` chain.

### `josh command:derive`

<!-- usage: command:derive -->

Write every artifact the command map derives — usage spans and catalog — and print page bytes against their ceilings.

```bash
pnpm josh command:derive   # after adding, renaming or describing a command
```

<!-- /usage -->

---

## Git hooks

### `josh prevent-main-commit`

<!-- usage: prevent-main-commit -->

Git hook: block commits to main.

```bash
pnpm josh prevent-main-commit   # run by the pre-commit hook
```

<!-- /usage -->

Installed as a pre-commit hook by `josh init`.

### `josh check-commit-message`

<!-- usage: check-commit-message -->

Git hook: validate commit message.

```bash
pnpm josh check-commit-message .git/COMMIT_EDITMSG   # run by the commit-msg hook
```

<!-- /usage -->

Installed as a commit-msg hook by `josh init`.

### `josh secretlint-scan`

<!-- usage: secretlint-scan -->

Git hook: scan staged files for secrets.

```bash
pnpm josh secretlint-scan src/app.ts .env.example   # the staged paths
```

<!-- /usage -->

Runs [secretlint](https://github.com/secretlint/secretlint) over the staged paths, wired into the pre-commit hook by `lefthook/base.yml` as `pnpm josh secretlint-scan {staged_files}`. A detected secret blocks the commit (exit code forwarded); without secretlint it prints a notice and exits `0` — `1` under `JOSH_SECRETLINT_REQUIRE=1` (CI).

**Options:** always passes `--no-glob` so lefthook's literal paths (e.g. SvelteKit `(app)` / `[id]` directories) are not treated as glob patterns.

### `josh pre-commit-lint`

<!-- usage: pre-commit-lint -->

Git hook: run cspell, prettier or eslint over staged files from a content cache.

```bash
pnpm josh pre-commit-lint cspell src/app.ts
pnpm josh pre-commit-lint prettier src/app.ts
pnpm josh pre-commit-lint eslint src/app.ts
```

<!-- /usage -->

Wired into `lefthook/base.yml` as `pnpm josh pre-commit-lint <tool> {staged_files}`; the tool's exit code is forwarded. Files follow `--`, so an option-like name stays a file.

- `cspell` and `eslint` write `.cspellcache.commit` and `.eslintcache.commit` (separate from the gate's caches).
- `prettier` shares `.prettiercache` with `josh lint`, so a commit right after a green gate re-checks nothing.
- `JOSH_PRE_COMMIT_LINT=off` skips all three; `josh ship` sets it for its local commit, whose tree the gate checks before the push.

### `josh pre-push-unit`

<!-- usage: pre-push-unit -->

Git hook: run unit tests, reusing a green gate recorded on the pushed tree.

```bash
pnpm josh pre-push-unit
```

<!-- /usage -->

The result is reused when [`josh gate`](josh-commands.md#josh-gate) recorded that exact, clean tree green.

```bash
JOSH_PRE_PUSH_FORCE=1 git push   # run the suite even on a tree recorded green
```

With `JOSH_PRE_PUSH_RELATED=1`, a push the record does not cover runs `josh test:related` instead of the whole suite — `josh ship` sets it when it pushes its sync merge onto an open pull request ahead of the gate.

**Output:** on reuse, prints that the tree is already green.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh pre-push-unit` in detail".

### `josh reserved-run`

<!-- usage: reserved-run -->

Git hook: run a command while holding a place in the machine-wide core budget.

```bash
pnpm josh reserved-run 2 -- pnpm install              # hold 2 cores while installing
pnpm josh reserved-run 1 -- pnpm josh audit           # hold 1 core while scanning
pnpm josh reserved-run 1 --memory 3000 -- <command>   # hold 3,000 MB beside the core
```

<!-- /usage -->

The budget is [`josh gate`](josh-commands.md#josh-gate)'s; the pre-push install and audit use it.

- `<weight> [--memory <MB>] -- <command...>`: the cores, optionally the memory, then the command.
- Memory: `--memory`, else the wrapped tool's `MEMORY_MB` times its `--concurrency` / `--maxWorkers`, `sh -c` read too (`scripts/gate/command-memory.ts`); a command it does not know reserves none.
- Claims a place before the command starts and waits while the budget is full, as a gate check does; the place is released when the command exits, and its exit code is forwarded.
- A missing separator, a non-integer weight, a malformed `--memory`, or no command is a usage error (exit `1`).
- A lane child launching `eslint` / `vitest` / `cspell` / `tsc` directly (bare, `pnpm exec`, `npx`, `sh -c`), or eslint above `--concurrency 1`, meets the `lane-direct-tool` row of `pnpm josh rule:list`; an interactive session outside a lane does not.
- The row rewrites a one-command line behind this command at the gate's weight, and refuses any other line, pointing at `josh lint:related` / `test:related` / `cspell:dot`.
- The command runs in the directory it was typed in (pnpm's `INIT_CWD`), not the package root.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh reserved-run` in detail".

### `josh pre-commit-type-check`

<!-- usage: pre-commit-type-check -->

Git hook: type-check, reusing a green gate recorded on the committed tree.

```bash
pnpm josh pre-commit-type-check
```

<!-- /usage -->

It type-checks the whole project (`pnpm exec tsc --noEmit`), reusing the result when [`josh gate`](josh-commands.md#josh-gate) recorded that exact, fully staged tree green.

```bash
JOSH_PRE_COMMIT_FORCE=1 git commit   # type-check even on a tree recorded green
```

**Output:** on reuse, prints that the tree is already green.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh pre-commit-type-check` in detail".

## AI tools

Helpers for AI-assisted development workflows.

### `josh repo:party`

<!-- usage: repo:party -->

Say whether a repository is first-party or third-party by owner equality (computed, not judged).

```bash
pnpm josh repo:party joshuafolkken/kit   # → first-party (in the kit session)
pnpm josh repo:party sveltejs/kit        # → third-party
pnpm josh repo:party                     # no argument: the session's own repository
```

<!-- /usage -->

Prints `first-party` / `third-party` / `unknown` on stdout, the two owners compared on stderr. Same owner as the session → `first-party`; else `third-party`; unreadable → `unknown`. The session owner is pinned at session start (`session-owner-pin.ts`), else `origin`.

The `third-party-write` row of `delivered-rules.ts` refuses with it a `gh api` or `gh … -R`/`GH_REPO` write to a repo we do not own; it refuses any GraphQL mutation or expanded query regardless of repo.
