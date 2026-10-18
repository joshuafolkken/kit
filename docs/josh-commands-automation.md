# josh CLI — Automation Command Reference

The commands a person rarely types: the ones Claude Code hooks, git hooks, the issue-driven workflow runs (`fullrun`, `backlogrun`, …) and lanes call, plus the `maintainer` commands kit's own maintainers run. Where each command came from: `docs/maintainers/josh-commands-automation-rationale.md` → "Where each command came from".

A `<!-- usage: … -->` span is generated from `scripts/josh/josh-usage-automation.ts`, `scripts/josh/josh-usage-workflow.ts` and `scripts/josh/josh-usage-hooks.ts` by `tsx scripts/document/generate-command-usage.ts` — edit the table, not the span.

## Development

These commands replace the corresponding `package.json` scripts; consumer projects need not add them manually.

### `josh refactor:scan`

Compute the refactoring candidates of `prompts/refactoring.md` §4.1–§4.3 over the changed files and answer `verdict: clear` / `verdict: candidates`. Reports and never fails.

<!-- usage: refactor:scan -->

```bash
pnpm josh refactor:scan
```

<!-- /usage -->

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh refactor:scan` in detail".

### `josh format:edited`

Format the single file an agent just edited. Not run by hand: `.claude/settings.json` wires it to `PostToolUse` and pipes the tool call as JSON on stdin; it reads `tool_input.file_path` and runs `eslint --fix` then `prettier --write` on that path alone.

<!-- usage: format:edited -->

```bash
pnpm josh format:edited   # run by the PostToolUse hook, the tool call as JSON on stdin
```

<!-- /usage -->

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
- **Reports the problems `eslint --fix` could not fix** — file, `line:col` and rule — on the same `additionalContext`, never failing the edit.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh format:edited` in detail".

### `josh batch:guard`

Refuse a tool call that would make a third consecutive single-call turn. Not wired standalone: it is one of the guards `josh pretool:guard` runs.

<!-- usage: batch:guard -->

```bash
pnpm josh batch:guard   # run inside pretool:guard, not wired on its own
```

<!-- /usage -->

```json
"PreToolUse": [
	{
		"matcher": "Bash|Edit|Read|Write|AskUserQuestion|Agent|Task",
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

- **`<project-root prefix>`** — `cd`s to `git rev-parse --show-toplevel` (with the git location variables a git hook exports cleared first), so a hook fired from a subdirectory still finds its relative paths. It is the same prefix the consumer rewrite applies, written out in full in the real file.
- **The launcher** (`scripts/hooks/run-hook.sh <name>`) hands the hook to the ready gate, falling back to `pnpm josh <command>`.
- **The ready gate** (`scripts/hooks/hook-bundle-ready.ts`) runs the bundle when its recorded digest matches the source, and rebuilds it in-process when stale.
- A consumer's command is rewritten to the installed launcher (`node_modules/@joshuafolkken/kit/scripts/hooks/run-hook.sh`), whose gate is a presence check on the installed `dist/hooks/` — the published bundles have no source beside them to go stale against — and whose fallback is the `dist/josh.js` dispatcher.

- The batch guard reaches `Bash`, `Edit`, `Read`, `Write`; the trailing `AskUserQuestion` in the matcher is the rule guard's, not this one's. `Bash`, `Edit`, `Read` are refusable; `Write` earns only a non-blocking notice. Refused only when two single-call turns are closed behind it, the call is bundleable, and it touches nothing the sequence already touched.
- **Silent in a dispatched lane child** (`JOSH_LANE_CHILD`): the notice is `off` there (`scripts/lane/lane-guard-policy.ts`). Why: `docs/maintainers/josh-commands-automation-rationale.md` → "The batching guard is off in a lane child".
- **Fires more than once per run**: again every `REFIRE_EVERY` further single-call turns (the notice every `NOTICE_REFIRE_EVERY`); a batched turn starts a fresh sequence.
- Set `JOSH_BATCH_GUARD` to `off` / `0` / `false` / `no` to disable.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh batch:guard` in detail".

### `josh time:density`

Report tool calls per round trip across the ten most recent lane sessions — the density the batching guard is measured on. Kit-only.

<!-- usage: time:density -->

```bash
pnpm josh time:density
pnpm josh time:density --lanes 5   # the five most recent lanes
```

**Options:**

- `--lanes <n>` — average over a different count of recent qualifying lanes (default 10).
- `--path <dir>` — read another project's lane transcripts, as `josh time` does. Run it from the main checkout — a lane reads only its own transcript.

<!-- /usage -->

```
lanes=10 round_trips=634 tools/turn=1.13 batched=63/634
```

- `tools/turn` is the canonical calls-per-round-trip density (floor 1.5), so it runs a little above the Issue's per-assistant-message frame (1.04), whose denominator also counts text-only turns. Use it as a behavior-change Issue's baseline so `josh measure:rerun` carries a before/after without a paste.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh time:density` in detail".

### `josh investigation:guard`

Refuse a file read once the run has read the threshold's worth of un-edited files since its last delegated unit, pushing bulk investigation into a delegated unit. Wired to `PreToolUse`, fed the pending call as JSON on stdin.

<!-- usage: investigation:guard -->

```bash
pnpm josh investigation:guard   # run by the PreToolUse hook, the pending tool call as JSON on stdin
```

<!-- /usage -->

```json
"PreToolUse": [
	{
		"matcher": "Read|Bash",
		"hooks": [{ "type": "command", "command": "pnpm josh investigation:guard", "timeout": 20 }]
	}
]
```

- On the `Bash` side only read-only lines are refused (`bat`, `cat`, `head`, `less`, `more`, `nl`, `sed`, `tail`); a delegation clears the pending set.
- **Search turns are counted as well** (`fd`, `find`, `grep`, `rg`): the third search turn since the last delegation or successful write is refused, parallel searches in one turn counting once. Every read-only search counts, the run's own instructions included — a search's named files cannot show a bare directory beside them, so no search can be proven to touch the instructions alone.
- The refusal points at the `investigator` agent (`.claude/agents/investigator.md`, shipped through the plugin as `kit:investigator`): `model: sonnet`, with `effort: low` and read-only tools. Excludes the run's own instructions (`CLAUDE.md`, `prompts/`, `.claude/skills/`) and harness session files.
- **A refusal in a dispatched lane child too** (`JOSH_LANE_CHILD`). Why: `docs/maintainers/josh-commands-automation-rationale.md` → "The investigation guard refuses in a lane child".
- Set `JOSH_INVESTIGATION_GUARD` to `off` / `0` / `false` / `no` to disable.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh investigation:guard` in detail".

### `josh duplicate-read:guard`

Refuse the second whole-file `Read` of a path whose content has not changed since the run last read it — the re-read returns text the run already holds, and across the latest five lanes a run re-read the same unchanged path 8.0 times on average. It runs inside `pretool:guard` (composed alongside `batch:guard`, `investigation:guard` and `rule:guard`), not as a separate `PreToolUse` entry.

<!-- usage: duplicate-read:guard -->

```bash
pnpm josh duplicate-read:guard   # run inside pretool:guard, not wired on its own
```

<!-- /usage -->

- The transcript gives the instant the path was last read; the filesystem's `mtime` says whether it has changed since. A file whose `mtime` predates that read is refused; one that has been edited, merged or grown by a background task — anything that moves the `mtime` — is let through.
- A read carrying an `offset` or `limit` reads a different region, so it is never refused. A stat that fails (a deleted or unreadable file) allows the call — the fallback is allow, never refuse.
- One refusal per accumulation: a run refused once and reading on anyway is not refused again, and the refusal re-arms when a fresh successful read of the target lands after it — the same shape as `investigation:guard`.
- **In a dispatched lane child it is a `notice`, not a refusal** (`JOSH_LANE_CHILD`), because a denial ends a headless turn — and the duplicates are measured in those children, so silencing it there would neuter it where the count lives. See the `pretool:guard` lane-child enumeration below.
- Set `JOSH_DUPLICATE_READ_GUARD` to `off` / `0` / `false` / `no` to disable.

### `josh rule:guard`

Deliver a rule at the tool call that binds it, instead of carrying it resident in `CLAUDE.md` every turn. Wired to `PreToolUse` (on `Bash` alone), fed the pending call as JSON on stdin.

<!-- usage: rule:guard -->

```bash
pnpm josh rule:guard   # run by the PreToolUse hook, the pending tool call as JSON on stdin
```

<!-- /usage -->

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

- **Direct filing** — trigger is a hand-built filing (`gh issue create`, or a `title`-bearing POST to a path ending `/issues`); refused on every occurrence and pointed at [`josh issue:file`](josh-commands-backlog.md#josh-issuefile), which runs every filing step itself.
- **Issue comments** — trigger reads an Issue body without them (`gh issue view <N>`, or a `GET` ending `…/issues/<N>`); hands over `gh issue view <N> --comments`.
- **Piped verification** — trigger is a josh check (`gate`, `check`, `lint*`, `cspell*`, `test*`, `eval`, `overrides`, `ranges`) standing anywhere but the last pipeline segment.
- **Early heartbeat** — trigger is a `Bash` call whose whole purpose is to wait; `pnpm josh run:progress --once` / `--wait` are exempt.
- **The pre-gate cut row**: the trigger is a `Bash` call that runs `pnpm josh gate` from a **lane** working tree that **has not yet taken its cut**, handing over `pnpm josh run:cut <N>` with what each of its six verdicts obliges. It exists because the step was carried as prose and fired **0 times in 6 lane children**; `--resume`, `--end` and `--json` do not count as taking the cut. `.claude/skills/workflow-commands/pre-gate-cut.md` is the single source of the procedure.
- **The implementation-phase cut row**: an `Edit` / `Write` from a lane that has not taken its cut, once `pnpm josh cost --cut` is over the shared threshold, hands over `pnpm josh run:cut --impl <N> --handoff <path>`; it fires on every threshold crossing.
- **Bare `pnpm josh git`** — trigger is a `pnpm josh git` with no `-y` / `--yes`; it prompts to confirm the staging, cancels with no TTY, and the run reissues with `-y` after throwing the time away. Hands over `pnpm josh git -y "<title> #<N>"`. Disjoint from the run-tail push row by the flag — that one requires `-y`, this refuses its absence — and it fires on every occurrence.

Set `JOSH_RULE_GUARD` to `off` / `0` / `false` / `no` to disable. Some rows deliver once per run, some on every occurrence, and some refuse until an earlier command has run.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh rule:guard` in detail".

### `josh rule:list`

Print the trigger-delivered rules `rule-delivery.md` points at: one item per guard row of `scripts/rules/delivered-rules.ts`, then the `Stop` hook's rows — single source, hook, trigger, silence. The prose comes from `scripts/rules/rule-registry.ts`, joined by `id`; a row with no entry prints as missing and fails `rule-list.test.ts`. A hookless agent reads it as its checklist.

<!-- usage: rule:list -->

```bash
pnpm josh rule:list   # print every trigger-delivered rule
```

<!-- /usage -->

### `josh pretool:guard`

The `PreToolUse` dispatcher that routes each pending tool call to the delivered-rule guards (`batch:guard`, `investigation:guard`, `duplicate-read:guard`, `rule:guard`). A refusal leaves through `hookSpecificOutput.permissionDecision`; an unclaimed call writes nothing.

<!-- usage: pretool:guard -->

```bash
pnpm josh pretool:guard   # run by the PreToolUse hook, the pending tool call as JSON on stdin
```

<!-- /usage -->

**How each guard behaves in a dispatched lane child is an enumeration** in `scripts/lane/lane-guard-policy.ts` — `refuse`, `notice` or `off` per guard; `lane-guard-policy.test.ts` pins it to the guards' live behavior.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh pretool:guard` in detail".

### `josh codex:hook-adapter`

The Codex counterpart of `pretool:guard` and `format:edited`: `pretool` or `posttool` reads a Codex hook payload on stdin, runs the same guard the Claude Code hook runs, and answers in Codex's hook format. `.codex/hooks.json` launches it as `sh scripts/hooks/run-hook.sh codex-hook-adapter <pretool|posttool>`; this command is the launcher's live-source fallback when the bundle cannot run.

<!-- usage: codex:hook-adapter -->

```bash
pnpm josh codex:hook-adapter pretool    # a Codex PreToolUse payload on stdin
pnpm josh codex:hook-adapter posttool   # a Codex PostToolUse payload on stdin
```

<!-- /usage -->

### `josh stop:guard`

The `Stop` hook: one process delivering the stop-time rules. It runs the stop notify, the hold release and the citation lines itself, blocking only when one fails; the rules that need the model block the stop. The rows are in `prompts/collaboration-workflow/rule-delivery.md`.

<!-- usage: stop:guard -->

```bash
pnpm josh stop:guard   # run by the Stop hook, the stop payload as JSON on stdin
```

<!-- /usage -->

`backlogrun`'s ordinary parent loop and the fetch of the next issue are handled by the supervisor process, so `stop:guard` does not count fetching the next issue toward a block. When a named epic is handed to a headless session for a decision, the lane-child wait protection still applies. Stall and leftover detection runs at the `Stop` event.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh stop:guard` in detail".

### `josh session:lang`

Print the language this session writes in, resolved from `JOSH_SESSION_LANG`. Wired to `UserPromptSubmit`; the `ja` default prints nothing.

<!-- usage: session:lang -->

```bash
pnpm josh session:lang   # run by the UserPromptSubmit hook; `ja` prints nothing
```

<!-- /usage -->

```json
{ "type": "command", "command": "pnpm josh session:lang", "timeout": 10 }
```

- Read via `process.loadEnvFile` (environment wins). Unset / empty / no-`.env` resolve to `ja`; `JOSH_SESSION_LANG=en` opts into English.
- While a `backlogrun` is live in the repository, it also prints one line telling the session to answer a progress question with `pnpm josh run:board --chat`, so a session that is not driving the run gets the rule too. No run, no line.

### `josh e2e:retry-check`

Report whether the preview server process died during a failed E2E attempt. Invoked by the distributed `ci.yml` between the two attempts of its E2E job.

<!-- usage: e2e:retry-check -->

```bash
pnpm josh e2e:retry-check
```

<!-- /usage -->

- Reads the preview server debug log (`WRANGLER_LOG_PATH`, default `e2e-web-server-logs`) and matches only when `Error in ProxyController` **and** `Network connection lost.` are in the same file. Verdict written to `$GITHUB_OUTPUT` as `crashed`; a missing/unreadable log ends at "no crash".

## Project

Commands for setting up and maintaining a project.

### `josh sync:scope`

Report whether the current change touches a file `josh sync` distributes.

<!-- usage: sync:scope -->

```bash
pnpm josh sync:scope            # the branch diff
pnpm josh sync:scope --staged   # the staged diff instead
pnpm josh sync:scope --json     # {"scope":"managed","reason":"..."}
```

**Options:**

- `--staged` — inspect the staged diff instead of the branch diff.
- `--json` — emit `{"scope","reason"}` as JSON.

<!-- /usage -->

**Output / exit codes:** the answer (`managed` or `clean`) goes to stdout, the reason to stderr. Exit status is `0` for both — this reports, it does not gate.

### `josh dogfood:commit`

Make the first commit of a test project a dogfood run created itself. Kit-only.

<!-- usage: dogfood:commit -->

```bash
pnpm josh dogfood:commit ~/Development/kit-test-html-start
```

<!-- /usage -->

An agent's own `git add` / `git commit` is refused wherever it points — the index guard cannot tell a throwaway project from the user's work — so this is the sanctioned route to a dogfood project's `Initial commit`. It runs `git init --initial-branch=main` when the directory has no `.git`, stages everything, commits `Initial commit` and names the branch `main`.

It refuses, changing nothing and exiting `1`, unless the directory:

- is named `kit-test-*` and exists;
- lies outside the kit checkout it is run from;
- has no commit yet, and is not inside another git repository — a `.git` without history, as `sv create` leaves, is accepted.

### `josh fresh:run`

Run one install scenario in a Docker container of a machine with nothing installed — no Node.js, pnpm, git or gh — and keep every command and its output as a log. Needs Docker on the machine it is run from.

<!-- usage: fresh:run -->

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
- `--log-dir <dir>` — where the log is written. Default: `.claude/tmp/fresh-machine`.
- `--rebuild` — build the machine image without the layer cache.

<!-- /usage -->

**Output / exit codes:** the session is written to `<log-dir>/<scenario>-<n>.log`, whose path is the last line. The exit status is the container's; a setup problem exits `1`.

A GitHub scenario creates a real private repository named after the run, and no run deletes one. The scenario format, the patterns and the token handling: [maintainers/fresh-machine.md](./maintainers/fresh-machine.md).

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh fresh:run` in detail".

### `josh auth:setup`

Run `claude setup-token` (a browser sign-in) and save the token to the macOS keychain — never shown, never in a file — for `fresh:run`'s `requires_claude` scenarios.

<!-- usage: auth:setup -->

```bash
pnpm josh auth:setup           # sign in and save the token
pnpm josh auth:setup --check   # ok: … saved on <date>, or missing: … and exit 1
```

<!-- /usage -->

**Exit codes:** `0` once saved; `1` on no token or no keychain (then set `CLAUDE_CODE_OAUTH_TOKEN`). Full handling: [maintainers/fresh-machine.md](./maintainers/fresh-machine.md#claude-code).

### `josh sonar:hotspots`

Fetch the SonarCloud hotspots on a pull request and print each one's Step B branch (`excluded` / `local` / `fix` / `defer`); a failed read prints `unreadable`, distinct from finding none. The project key comes from `sonar-project.properties` and the upstream-synced branch key from `sync:scope`'s own detection. Full handling: `prompts/sonar-hotspot-handling.md`.

<!-- usage: sonar:hotspots -->

```bash
pnpm josh sonar:hotspots 42
```

<!-- /usage -->

### `josh sonar:new-code`

Fail when a pull request adds any new SonarCloud issue or duplicated block, printing `clean` (exit `0`), `findings: …` or `unreadable: …` (exit `1`). Handling: `prompts/sonar-hotspot-handling.md`.

<!-- usage: sonar:new-code -->

```bash
pnpm josh sonar:new-code 42
```

<!-- /usage -->

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh sonar:new-code` in detail".

### `josh ui:routes`

List the screenshot-target routes the change touches: a changed `+page` / `+layout` gives its own route, a changed shared component the routes that import it (a one-level `src/routes` scan). Empty output prints "no route derived" rather than guessing; the `verify-ui` skill's §1 narrows the list.

<!-- usage: ui:routes -->

```bash
pnpm josh ui:routes            # the branch diff
pnpm josh ui:routes --staged   # the staged diff instead
```

<!-- /usage -->

### `josh propagate`

Carry the release this repository just published into every consumer repository checked out next to it. Runs only from the clean, up-to-date default branch of kit or a CLI-shipping toolkit (app-kit, game-kit); waits for the exact published version to appear in the registry before touching any consumer.

Staged delivery: kit → app-kit → joshuafolkken-com / game-kit → waneccha. A toolkit also carries its base packages, pinned to its installed versions. Each consumer is delivered by the topmost toolkit it installs; lower runs report it `skipped`, naming that toolkit.

<!-- usage: propagate -->

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

Per consumer, in order: working-tree check, `pnpm add -D <package>@<version>` per carried package, `pnpm <bin> sync` per carried package (base first), verification gate, open upgrade issue, `pnpm josh git`, return to default branch. One consumer's failure never stops another; each is reported as `propagated`, `failed` (with the step, reason, and what it left behind), or `skipped`.

The opposite direction — one consumer catching itself up from its own checkout — is [`josh adopt`](josh-commands.md#josh-adopt).

## Workflow

AI-assisted git and notification helpers used in the day-to-day development loop.

### `josh pr:classification`

Use one label (see PR template). Bots may omit it; label changes rerun only the `Release classification` workflow (`.github/workflows/pr-classification.yml`), never CI.

<!-- usage: pr:classification -->

```bash
pnpm josh pr:classification   # run by CI on a pull request; fails without one label
```

<!-- /usage -->

### `josh followup`

AI-assisted PR follow-up workflow: waits for CI, checks AI-reviewer findings, sends the completion notification, and merges.

<!-- usage: followup -->

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

**Acceptance-criteria map:** the Issue is re-read just before the merge. A merge is refused when one of its acceptance criteria has no row under the PR body's `## 受け入れ条件の対応`, or a deferral row names an issue that does not exist.

Rows match by an identifier built from the criterion's text, so a criterion added or reworded later has no row. An Issue with no acceptance section merges as before. `josh pr` writes a pending row per criterion; the format is `prompts/collaboration-workflow/report-format.md` → "PR 本文の受け入れ条件の対応表".

**Behavior:** waits for CI (every 10 s, a 32-minute budget, `JOSH_CI_TIMEOUT_SECONDS`), merges, then closes completed epics and the Issue, removes `in-progress` and flushes the ledger. A person's unacknowledged update stops it unmerged ([`josh issue:ack`](josh-commands-backlog.md#josh-issueack)). Give the call its longest timeout.

**Output / exit codes:** exits non-zero naming the failing check on a red run; prints a per-stage timing block (`followup stage: <name> <n> s`) on both success and failure.

Related: [`josh git`](josh-commands.md#josh-git), [`josh observations:flush`](#josh-observationsflush), [`josh time`](josh-commands-run.md#josh-time).

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh followup` in detail".

### `josh notify`

Send a Telegram notification.

<!-- usage: notify -->

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

Commit the observation ledger lines no run's own commit carried (`.josh/observations/`) as a pull request of its own and merge it. A run's lines ride its own commit, so only lines written outside any run are left here.

<!-- usage: observations:flush -->

```bash
pnpm josh observations:flush
```

<!-- /usage -->

**Behavior:** refused off the default branch or beside any other change; prints `clean` when there is nothing to commit. `pnpm josh run:tail` runs it after a merge.

Related: [`josh followup`](#josh-followup).

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh observations:flush` in detail".

### `josh measure:rerun`

Re-run a behavior-change Issue's declared baseline after it merges and print the before/after pair. It reads the Issue's `## ベースライン` section, runs each `` `<command>` → <value> `` entry, and prints the recorded value beside the re-measured one — the merge-time re-read a prose rule never gets.

<!-- usage: measure:rerun -->

```bash
pnpm josh measure:rerun 2212
```

<!-- /usage -->

**Trust:** a baseline is shell, so it runs only for an `OWNER` / `MEMBER` / `COLLABORATOR` author; any other author, or an unreadable issue, exits 1 before any command runs. A command over its one-minute budget prints `(command failed: …)` and the rest still run.

**Behavior:** a value that has not moved records the rule's premise as refuted — one line in the observation ledger (`.josh/observations/`). A prose measurement is refused.

Related: [`josh observations:flush`](#josh-observationsflush), [`josh issue:lint`](josh-commands-backlog.md#josh-issuelint).

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh measure:rerun` in detail".

### `josh observation:record`

Count a `- k:<key>` sighting across `.josh/observations/`, append it, and print `file` (the second sighting — file it) or `ledger`; earlier sightings go to stderr. A malformed or `k:example` line is refused with exit 1. `--checkout <path>` uses another repository's ledger. The rule: `.claude/skills/workflow-commands/observation-ledger.md`.

<!-- usage: observation:record -->

```bash
pnpm josh observation:record flaky-e2e d1 'tests/e2e/login.test.ts' 'times out on CI only'
pnpm josh observation:record flaky-e2e d1 'src/app.ts' 'fails there too' --checkout ~/Development/app   # another repository's ledger
```

**Options:**

- `--checkout <path>` — count and append in that repository's `.josh/observations/` instead.

<!-- /usage -->

### `josh review:record`

Record a `/code-review` round's findings as `- rf:` lines in the issue's ledger file (`.josh/observations/<N>.md`) — the one write path for findings.

<!-- usage: review:record -->

```bash
pnpm josh review:record --issue 2325 bug-risks:medium:src/foo.ts:42 tests:low:a.test.ts
pnpm josh review:record --issue 2325                                                      # a zero-finding round — records one `none` line
pnpm josh review:record --issue 2325 --comment                                            # a round that passed after the PR opened — an Issue comment, no append
pnpm josh review:record --check --issue 2325                                              # the merge gate: was it recorded?
```

<!-- /usage -->

**Behavior:** each positional is `<category>:<severity>:<file>`; no findings writes one `- rf:none` line. `--comment` posts the lines on the issue instead, for a round after the pull request opened.

**`--check --issue <N>` is the merge gate** [`josh followup`](#josh-followup) runs: a `- rf:` line for the issue is `ok`, its absence is `missing`, no ledger `not-required`.

Related: [`josh review:findings`](josh-commands.md#josh-reviewfindings), [`josh observations:flush`](#josh-observationsflush).

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh review:record` in detail".

## Versioning

### `josh bump`

Bump the package version in `package.json`. Not part of the child flow — `josh release` raises the version instead.

<!-- usage: bump -->

```bash
pnpm josh bump major
pnpm josh bump minor
pnpm josh bump patch
```

<!-- /usage -->

After bumping, update `docs/` to reflect any behavior changes before committing.

### `josh release`

Release everything main has taken since the version last changed: raise the version by one minor per merge, open and merge a `release/v<version>` pull request, then wait for the tag, the npm publish and the GitHub Release, printing one line per stage:

```text
📝 Release PR opened: https://github.com/<owner>/<repo>/pull/<N>
🔀 Release PR merged: https://github.com/<owner>/<repo>/pull/<N>
🏷 Tag vX.Y.Z created
📦 Published to npm: https://www.npmjs.com/package/<name>/v/X.Y.Z
📰 GitHub Release created: https://github.com/<owner>/<repo>/releases/tag/vX.Y.Z
🎉 Release vX.Y.Z complete
```

A package whose `package.json` says `private: true` is not published to npm, so its npm stage is skipped.

<!-- usage: release -->

```bash
pnpm josh release
pnpm josh release --dry-run   # count and report, write nothing
```

**Options:**

- `--dry-run` — count and report only; writes nothing, fetches nothing, and creates no work tree.
- `--help` / `-h` — print the usage line and exit 0 without fetching or releasing. Any other argument is refused with the usage line and a non-zero exit, before anything is fetched.

<!-- /usage -->

**Runs in its own work tree, never the root checkout**, so a release can run beside a [`backlogrun`](how-to/run-issues.md) on a dirty root.

The watch budgets are read from the environment:

- `JOSH_RELEASE_TAG_TIMEOUT_SECONDS` (env) — tag-watch budget, default 30 minutes.
- `JOSH_RELEASE_NPM_TIMEOUT_SECONDS` (env) — npm-publish watch budget, default 30 minutes.
- `JOSH_RELEASE_GITHUB_RELEASE_TIMEOUT_SECONDS` (env) — GitHub Release watch budget, default 30 minutes.

**Output / exit codes:** exits 0 and writes nothing when the pending count is zero; exits non-zero if `origin/<default>` cannot be read, no version base can be found, the `release/v<version>` branch is already taken (locally or on origin), or a watched stage — the `v<version>` tag, the npm version, the GitHub Release — never appears, which prints that stage with ❌.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh release` in detail".

### `josh release:scope`

Say whether a release is owed, so the moment one is cut is not a judgement. Reads the same fetch-then-count as `josh followup`, so the two never disagree.

<!-- usage: release:scope -->

```bash
pnpm josh release:scope          # → required | skip | unknown
pnpm josh release:scope --json   # {"scope":"…","reason":"…"} on one line
```

<!-- /usage -->

| It answers | When                                                             |
| ---------- | ---------------------------------------------------------------- |
| `required` | main has taken at least one merge since the version last changed |
| `skip`     | the count is zero                                                |
| `unknown`  | the count could not be read                                      |

**Output / exit codes:** the verdict goes to stdout, the reason to stderr. Exit code is 0 for every verdict and 1 only for an unknown flag; `unknown` is a verdict, never read as `skip`.

### `josh release:github`

Create the GitHub Release for a tag `josh release` cut, with notes from `.github/release.yml`. Run by CI — kit's `publish.yml`, and the `github-release.yml` every consumer receives.

<!-- usage: release:github -->

```bash
pnpm josh release:github   # run by CI with GH_TOKEN, RELEASE_TAG and GITHUB_REPOSITORY set
```

<!-- /usage -->

```bash
GH_TOKEN=… RELEASE_TAG=v1.2.0 GITHUB_REPOSITORY=owner/repo pnpm josh release:github
```

It takes no arguments: `--help` / `-h` prints the usage line and exits 0 without reading the environment or releasing, and any other argument is refused with the usage line and a non-zero exit, before anything is released.

| Environment             | Meaning                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `GH_TOKEN`              | Token with `contents: write` and `actions: read`. Required                                              |
| `RELEASE_TAG`           | The tag to release. Required                                                                            |
| `GITHUB_REPOSITORY`     | `owner/repo` to release in — set by GitHub Actions. Required                                            |
| `RELEASE_START_TAG`     | Last tag before automatic releases. Unset: the latest release is the floor; none: the nearest lower tag |
| `RELEASE_WORKFLOW`      | Publish workflow (file or id) whose failed run for a lower tag skips it. Unset: wait for its release    |
| `RELEASE_JOBS`          | Comma-separated jobs in that workflow whose failure counts. Unset: any failed job                       |
| `RELEASE_AWAIT_PUBLISH` | `true`: wait for the tag's own `Publish <tag>` run in `RELEASE_WORKFLOW` to succeed; skip when it fails |
| `RELEASE_RUN_WORKFLOW`  | Workflow whose run creates a tag's release (`RELEASE_WORKFLOW` when it does). Unset: wait for a release |

Releases are created in version order: a later tag waits for the nearest lower one, and skips a tag whose publication failed.

**Output / exit codes:** prints `published <tag> from <baseline>` or `already-published`; exits non-zero on an API error, an invalid tag or repository, a latest release that is not older than the tag, or a lower tag that never gets a release within the wait budget.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh release:github` in detail".

## Maintenance

### `josh ruleset:check`

Check that the default branch requires every status check kit's distributed workflows report.

<!-- usage: ruleset:check -->

```bash
pnpm josh ruleset:check           # report only
pnpm josh ruleset:check --apply   # add the missing checks to the existing rule
```

**Options:**

- `--apply` — append the missing checks to the ruleset's required-checks rule (or to the branch protection's contexts). It never creates a ruleset: with none, create one under Settings → Rules → Rulesets, then rerun. Writing a repository setting needs admin access, so only this flag writes — `josh sync` and `josh doctor` never do.

<!-- /usage -->

A distributed workflow's check gates nothing until the repository requires it — a per-repository setting. `ruleset:check` reads the default branch's rules — its rulesets first, classic branch protection when no ruleset requires a check — and compares them with the checks of the distributed workflows the repository actually has:

| Workflow                                  | Checks                                          |
| ----------------------------------------- | ----------------------------------------------- |
| `.github/workflows/ci.yml`                | `Checks`, `Detect E2E`, `E2E`, `Security Audit` |
| `.github/workflows/sonar-qube.yml`        | `SonarQube`                                     |
| `.github/workflows/pr-classification.yml` | `Release classification`                        |

A workflow the repository does not have contributes nothing. `E2E` is safe to require without an E2E suite: the job is skipped then, and a skipped required check passes. Checks the repository requires beyond these are left alone.

It exits `0` when every expected check is required and `1` otherwise — when one is missing, nothing requires checks at all, or the rules could not be read (a failed read is never reported as missing).

### `josh audit:provision`

Install the pinned `osv-scanner` when `josh audit` cannot find one. Wired to the `SessionStart` hook of the distributed `.claude/settings.json` so the pre-push audit has a scanner.

<!-- usage: audit:provision -->

```bash
pnpm josh audit:provision           # no-op if a scanner is already present
pnpm josh audit:provision --force   # ignore backoff, allow a longer download
```

**Options:**

- `--force` — ignore the 6-hour failure backoff and allow a longer download window; the command to run after fixing a network problem.

<!-- /usage -->

**Output / exit codes:** the version is pinned and its SHA256 verified before install. Any failure (network, non-OK response, checksum mismatch, no published build) is reported and exits `0` — the missing scanner surfaces at the pre-push audit instead.

### `josh lockfile:policy`

Re-verify the lockfile against `minimumReleaseAge` with pnpm's own check, which `trustLockfile: true` skips on install — a raised window leaves younger versions locked until Safe Chain refuses them. Kit's own; the gate's `lockfile` check.

<!-- usage: lockfile:policy -->

```bash
pnpm josh lockfile:policy   # verify when the lockfile or its policy moved
```

<!-- /usage -->

**Output / exit codes:** silent `0` when neither `pnpm-lock.yaml` nor `pnpm-workspace.yaml` moved from the merge-base; otherwise pnpm's verdict (about a minute).

### `josh reconcile-templates`

Keep the distributed templates in sync with the root files they come from. **Copy pairs** are byte-for-byte copies regenerated automatically (`.gitignore` → `templates/gitignore`); **tripwire pairs** intentionally diverge and only force a conscious review via a recorded hash (`sonar-project.properties` → `templates/sonar-project.properties`).

<!-- usage: reconcile-templates -->

```bash
pnpm josh reconcile-templates           # regenerate copy templates + record tripwire hashes
pnpm josh reconcile-templates --check   # verify templates are in sync; non-zero on drift
```

**Options:**

- `--check` — verify only; exits non-zero on drift. A pre-commit hook runs this when a tracked source or copy template is staged.

<!-- /usage -->

Tripwire hashes live in `.template-source-manifest.json` (kit-internal, not distributed).

### `josh latest:scope`

The update itself — [`josh latest`](josh-commands.md#josh-latest) — is a command you type.

<!-- usage: latest:scope -->

```bash
pnpm josh latest:scope            # required or skip, the reason on stderr
pnpm josh latest:scope --record   # note a finished josh latest run
pnpm josh latest:scope --json     # the verdict and the reason as JSON
```

**Options:**

- `--record` — write the completion record `josh latest` ends with.
- `--json` — emit the verdict and its reason as JSON.

<!-- /usage -->

Prints `required` or `skip` (reason on stderr) — whether this checkout must update; read it with `$(pnpm josh latest:scope)`. A completion record younger than **12 hours** (`JOSH_LATEST_MAX_AGE_HOURS`) answers `skip`; `--record` writes it.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh latest:scope` in detail".

### `josh latest:guard`

Fronts the `josh latest` chain and refuses inside a lane; a lane's per-root stamp always reads stale.

<!-- usage: latest:guard -->

```bash
pnpm josh latest:guard   # refuses inside a lane
```

<!-- /usage -->

---

## Git hooks

### `josh prevent-main-commit`

Blocks direct commits to `main`. Installed as a pre-commit hook by `josh init`.

<!-- usage: prevent-main-commit -->

```bash
pnpm josh prevent-main-commit   # run by the pre-commit hook
```

<!-- /usage -->

### `josh check-commit-message`

Validates commit message format. Installed as a commit-msg hook by `josh init`.

<!-- usage: check-commit-message -->

```bash
pnpm josh check-commit-message .git/COMMIT_EDITMSG   # run by the commit-msg hook
```

<!-- /usage -->

### `josh secretlint-scan`

Runs [secretlint](https://github.com/secretlint/secretlint) over the staged paths passed as arguments. Wired into the pre-commit hook by `lefthook/base.yml` as `pnpm josh secretlint-scan {staged_files}`. When secretlint is installed the scan runs and its exit code is forwarded, so a detected secret blocks the commit; when it is not installed the wrapper prints a notice and exits `0`.

<!-- usage: secretlint-scan -->

```bash
pnpm josh secretlint-scan src/app.ts .env.example   # the staged paths
```

<!-- /usage -->

**Options:** always passes `--no-glob` so lefthook's literal paths (e.g. SvelteKit `(app)` / `[id]` directories) are not treated as glob patterns.

### `josh pre-commit-lint`

Runs cspell, prettier or eslint over the staged paths for the pre-commit hook, with a content-strategy cache. Wired into `lefthook/base.yml` as `pnpm josh pre-commit-lint <tool> {staged_files}`; the tool's exit code is forwarded.

<!-- usage: pre-commit-lint -->

```bash
pnpm josh pre-commit-lint cspell src/app.ts
pnpm josh pre-commit-lint prettier src/app.ts
pnpm josh pre-commit-lint eslint src/app.ts
```

<!-- /usage -->

- `cspell` and `eslint` write `.cspellcache.commit` and `.eslintcache.commit`. A staged-files run would prune the gate's cspell cache, and `eslint --quiet` would store reports without their warnings in the gate's cache.
- `prettier` shares `.prettiercache` with `josh lint`, so a commit right after a green gate re-checks nothing.

### `josh pre-push-unit`

Runs the unit suite for the pre-push hook, reusing the result when [`josh gate`](josh-commands.md#josh-gate) recorded that exact, clean tree green.

<!-- usage: pre-push-unit -->

```bash
pnpm josh pre-push-unit
```

<!-- /usage -->

```bash
JOSH_PRE_PUSH_FORCE=1 git push   # run the suite even on a tree recorded green
```

**Output:** on reuse, prints that the tree is already green and nothing was re-run.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh pre-push-unit` in detail".

### `josh reserved-run`

Runs a command while holding a place in the machine-wide core budget ([`josh gate`](josh-commands.md#josh-gate)'s), for the pre-push install and audit.

<!-- usage: reserved-run -->

```bash
pnpm josh reserved-run 2 -- pnpm install      # hold 2 cores while installing
pnpm josh reserved-run 1 -- pnpm josh audit   # hold 1 core while scanning
```

<!-- /usage -->

- `<weight> -- <command...>`: the cores to reserve, then the command to run while holding them. The weight is the caller's — a conservative reservation for these two, not a measurement.
- Claims a place before the command starts and waits while the budget is full, exactly as a gate check does; the place is released when the command exits, on success or failure, and its exit code is forwarded.
- A missing separator, a non-integer weight, or no command is a usage error (exit `1`) — a pre-push command that ran unguarded would be the bug this removes.

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh reserved-run` in detail".

### `josh pre-commit-type-check`

Type-checks the whole project for the pre-commit hook (`pnpm exec tsc --noEmit`), reusing the result when [`josh gate`](josh-commands.md#josh-gate) recorded that exact, fully staged tree green.

<!-- usage: pre-commit-type-check -->

```bash
pnpm josh pre-commit-type-check
```

<!-- /usage -->

```bash
JOSH_PRE_COMMIT_FORCE=1 git commit   # type-check even on a tree recorded green
```

**Output:** on reuse, prints that the tree is already green and nothing was re-run.

---

Detail: `docs/maintainers/josh-commands-automation-rationale.md` → "`josh pre-commit-type-check` in detail".

## AI tools

Helpers for AI-assisted development workflows.

### `josh repo:party`

Says whether a repository is **first-party** or **third-party** — computed by owner equality, not
judged. Prints one of `first-party` / `third-party` / `unknown`
on stdout, and the two owners it compared on stderr.

<!-- usage: repo:party -->

```bash
pnpm josh repo:party joshuafolkken/kit   # → first-party (in the kit session)
pnpm josh repo:party sveltejs/kit        # → third-party
pnpm josh repo:party                     # no argument: the session's own repository
```

<!-- /usage -->

The target's owner equals the session repository's owner → `first-party`; it differs → `third-party`;
either owner cannot be read (no `origin`, an unreadable config, a malformed argument) → `unknown`,
which is never read as `third-party`. This is the mechanical test `CLAUDE.md` → "Third-party
repositories are Tier C" and `prompts/collaboration-workflow/upstream-interrupt.md` describe; the
`third-party-write` row of `delivered-rules.ts` computes the same thing to refuse a `gh api` write to a
repository we do not own (a read passes untouched).
