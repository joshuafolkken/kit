# josh CLI — Automation Command Reference

The commands a person rarely types: the ones Claude Code hooks, git hooks, the issue-driven workflow runs (`fullrun`, `backlogrun`, …) and lanes call, plus the `maintainer` commands kit's own maintainers run. The run, lane and session commands (`josh run:*`, `josh lane:*`, `josh ship`, `josh cost`, `josh doc:*`, `josh read:*`, `josh edit:files`, `josh time`, `josh retrospective`, `josh eval`) are in [josh-commands-run.md](josh-commands-run.md). The commands you type by hand are in [josh-commands.md](josh-commands.md); every command is indexed in the [Command Catalog](josh-command-catalog.md). The issues each command came from: `docs/maintainers/josh-commands-automation-rationale.md` → "Where each command came from".

## Development

These commands replace the corresponding `package.json` scripts; consumer projects need not add them manually.

### `josh refactor:scan`

Compute the refactoring candidates `prompts/refactoring.md` §4.1–§4.3 describes, run as a command: it picks the target files (branch diff plus untracked, or `scripts/`; excluding `demo`, `src/routes/stories`, `/* @refactor-ignore */`), expands the scope along the import graph, asks the project's own eslint for the §4.2 categories, and answers `verdict: clear` / `verdict: candidates`. Reports and never fails.

```bash
pnpm josh refactor:scan
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

Refuse a tool call that would make a third consecutive single-call turn, pushing the run toward batching independent calls. It is **not wired standalone**: it is one of the three `PreToolUse` guards consolidated into `josh pretool:guard` (with `investigation:guard` and the rule guard), so `.claude/settings.json` names the union of their matchers and runs the one process, fed the pending call as JSON on stdin.

```json
"PreToolUse": [
	{
		"matcher": "Bash|Edit|Read|Write|AskUserQuestion",
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
- **The launcher** (`scripts/hooks/run-hook.sh <name> [arguments]`) holds everything the hooks share, once: it clears the git location variables for the hook itself when the root resolves without them, runs `dist/hooks/<name>.js` once the ready gate passes, and otherwise runs the live source through `pnpm josh <command>` — the name with its first `-` turned into `:` (`pretool-guard` → `pretool:guard`).
- **The ready gate** (`scripts/hooks/hook-bundle-ready.ts`, run by plain `node`) compares a content digest of the bundle inputs recorded at build time (`dist/hooks/inputs.json`) with the source on disk. Fresh → the bundle runs. Stale → it rebuilds `dist/hooks/` in-process (a fraction of a second) and says so on stderr, so an edited guard is never shadowed by its old bundle. A checkout that cannot build drops to the `pnpm josh` fallback with a stderr warning — that path is slow and a hook exceeding its timeout lets the call through unguarded.
- A consumer's command is rewritten to the installed launcher (`node_modules/@joshuafolkken/kit/scripts/hooks/run-hook.sh`), whose gate is a presence check on the installed `dist/hooks/` — the published bundles have no source beside them to go stale against — and whose fallback is the `dist/josh.js` dispatcher.

- The batch guard reaches `Bash`, `Edit`, `Read`, `Write`; the trailing `AskUserQuestion` in the matcher is the rule guard's, not this one's. `Bash`, `Edit`, `Read` are refusable; `Write` earns only a non-blocking notice. Refused only when two single-call turns are closed behind it, the call is bundleable, and it touches nothing the sequence already touched.
- **Silent in a dispatched lane child** (`JOSH_LANE_CHILD`): a _refusal_ ends a headless child's turn, and a `PreToolUse` hook cannot see the turn it is in, so the notice is **`off`**; the lever that moves the density is a composite command (`read:files` / `edit:files`). Decided in `scripts/lane/lane-guard-policy.ts` — `refuse` / `notice` / `off`. Why: `docs/maintainers/josh-commands-automation-rationale.md` → "The batching guard is off in a lane child".
- **Fires more than once per run** (main line). The first firing lands when a run of single-call turns reaches the limit; if the run keeps single-calling it fires again — the **refusal** every `REFIRE_EVERY` further turns (the initial limit), the **notice** every `NOTICE_REFIRE_EVERY` (tighter, since a notice cannot wedge a run). Both are single constants in `time-batch-guard.ts`. A call re-issued unchanged after a firing is let through, and a batched turn starts a fresh sequence.
- Set `JOSH_BATCH_GUARD` to `off` / `0` / `false` / `no` to disable.

### `josh time:density`

Report tool calls per round trip across the recent lane sessions — the density the batching guard is measured on, as a command rather than a hand-counted `node -e`. Kit-only (it reads kit's own lane transcripts). Aggregates the ten most recent lane sessions holding at least thirty round trips, dividing summed calls by summed round trips through the same `time-round-trips.ts` the guard and the live density line read, so the three cannot disagree about what a round trip is.

```
lanes=10 round_trips=634 tools/turn=1.13 batched=63/634
```

- `--lanes <n>` averages over a different count of recent qualifying lanes (default 10); `--path <dir>` reads another project's lane transcripts, as `josh time` does. Run it from the main checkout — a lane reads only its own transcript.
- `tools/turn` is the canonical calls-per-round-trip density (floor 1.5), so it runs a little above the Issue's per-assistant-message frame (1.04), whose denominator also counts text-only turns. Use it as a behavior-change Issue's baseline so `josh measure:rerun` carries a before/after without a paste.

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

- On the `Bash` side only read-only lines are refused (`bat`, `cat`, `head`, `less`, `more`, `nl`, `sed`, `tail`); a delegation clears the pending set.
- **Search turns are counted as well** (`fd`, `find`, `grep`, `rg`): the third search turn since the last delegation or successful write is refused, parallel searches in one turn counting once. Every read-only search counts, the run's own instructions included — a search's named files cannot show a bare directory beside them, so no search can be proven to touch the instructions alone.
- The refusal points at the `investigator` agent (`.claude/agents/investigator.md`, shipped through the plugin as `kit:investigator`): no `model` key, so it inherits the parent's, with `effort: low` and read-only tools. Excludes the run's own instructions (`CLAUDE.md`, `prompts/`, `.claude/skills/`) and harness session files.
- **A notice, not a refusal, in a dispatched lane child** (`JOSH_LANE_CHILD`): a _refusal_ ends a headless child's turn, so the guard delivers the same guidance as a non-blocking notice — the read proceeds with the guidance attached, and the notice **names the concrete unedited files** the run read. Why: `docs/maintainers/josh-commands-automation-rationale.md` → "The investigation guard is a notice in a lane child". Decided from the one-place enumeration in `scripts/lane/lane-guard-policy.ts`.
- Set `JOSH_INVESTIGATION_GUARD` to `off` / `0` / `false` / `no` to disable.

### `josh duplicate-read:guard`

Refuse the second whole-file `Read` of a path whose content has not changed since the run last read it — the re-read returns text the run already holds, and across the latest five lanes a run re-read the same unchanged path 8.0 times on average. It runs inside `pretool:guard` (composed alongside `batch:guard`, `investigation:guard` and `rule:guard`), not as a separate `PreToolUse` entry.

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

- **Direct filing** — trigger is a hand-built filing (`gh issue create`, or a `title`-bearing POST to a path ending `/issues`); refused on every occurrence and pointed at [`josh issue:file`](#josh-issuefile), which runs every filing step itself.
- **Backlog WIP cap** — trigger is a `Bash` call that files an Issue (`pnpm josh issue:file`).
- **Issue comments** — trigger reads an Issue body without them (`gh issue view <N>`, or a `GET` ending `…/issues/<N>`); hands over `gh issue view <N> --comments`.
- **Piped verification** — trigger is a josh check (`gate`, `check`, `lint*`, `cspell*`, `test*`, `eval`, `overrides`, `ranges`) standing anywhere but the last pipeline segment.
- **Early heartbeat** — trigger is a `Bash` call whose whole purpose is to wait; `pnpm josh run:progress --once` / `--wait` are exempt.
- **The pre-gate cut row**: the trigger is a `Bash` call that runs `pnpm josh gate` from a **lane** working tree that **has not yet taken its cut**, handing over `pnpm josh run:cut <N>` with what each of its six verdicts obliges. It exists because the step was carried as prose and fired **0 times in 6 lane children**; `--resume`, `--end` and `--json` do not count as taking the cut. `.claude/skills/workflow-commands/pre-gate-cut.md` is the single source of the procedure.
- **The implementation-phase cut row**: the trigger is an `Edit` / `Write` from a **lane** working tree that has not yet taken its cut, once the recent-context verdict (`pnpm josh cost --cut`'s, unmeasurable read `!== UNDER` on the safety-net side) is over the shared threshold, handing over `pnpm josh run:cut --impl <N> --handoff <path>`. Unlike the pre-gate row it **fires on every threshold crossing**: once per run left a `busy` / `failed` verdict to grow the context unwatched, so it carries `decide` and lets an edit reissued right after a refusal through. The verdict read is reused over a few-second per-checkout window. `.claude/skills/workflow-commands/pre-gate-cut.md` is the single source.
- **Bare `pnpm josh git`** — trigger is a `pnpm josh git` with no `-y` / `--yes`; it prompts to confirm the staging, cancels with no TTY, and the run reissues with `-y` after throwing the time away. Hands over `pnpm josh git -y "<title> #<N>"`. Disjoint from the run-tail push row by the flag — that one requires `-y`, this refuses its absence — and it fires on every occurrence.

Set `JOSH_RULE_GUARD` to `off` / `0` / `false` / `no` to disable. Some rows deliver once per run; some — force push / branch delete, direct filing, the bare-`git` and run-tail push rows, and the implementation-phase cut — fire on every occurrence; and a row that asks for an earlier command (`issue:fold`, the Issue comments, `pkg:scout`, the rule-body placement questions) refuses every call until that command is on the transcript.

### `josh pretool:guard`

The `PreToolUse` dispatcher that routes each pending tool call to the delivered-rule guards (`batch:guard`, `investigation:guard`, `duplicate-read:guard`, `rule:guard`). A refusal leaves through `hookSpecificOutput.permissionDecision`; an unclaimed call writes nothing.

**How each of the four behaves in a dispatched lane child is an enumeration, not a judgement**. A denial is guidance to an interactive main line but a fatal turn-ender to a headless `claude -p` child, so `scripts/lane/lane-guard-policy.ts` lists, in one place, each guard's three-valued mode for a lane child (`JOSH_LANE_CHILD`) — `refuse`, `notice`, or `off`: `investigation` is `notice` (it names the concrete unedited files rather than refusing), `batching` is `off` (a notice is structurally unable to reach the turn it would pack), `duplicate-read` is `notice` (a refusal would kill the child, and the unchanged re-reads it catches are measured in those very children — so it nudges rather than silences), while `rule` stays `refuse` — it carries the lane-only rules a child depends on (`pre-gate-cut`, `lane-park`) and the safety rules it must still obey. `lane-guard-policy.test.ts` pins that the enumeration and the guards' live behavior cannot disagree.

### `josh codex:hook-adapter`

The Codex counterpart of `pretool:guard` and `format:edited`: `pretool` or `posttool` reads a Codex hook payload on stdin, runs the same guard the Claude Code hook runs, and answers in Codex's hook format. `.codex/hooks.json` launches it as `sh scripts/hooks/run-hook.sh codex-hook-adapter <pretool|posttool>`; this command is the launcher's live-source fallback when the bundle cannot run.

### `josh stop:guard`

The `Stop` hook: one process delivering the four stop-time rules — stop-notification, hold-release, filing-offer and issue-citation all **block** the stop, since `{"decision":"block"}` is a `Stop` hook's one channel to the model. A reply whose prose offers to file an Issue ("起票してよければ", "Shall I file …") on a turn whose transcript tail holds no filing that a guard let through is sent back to file it with `pnpm josh issue:file`, because a first-party filing is Tier A (`observation-filing.md`); it stays silent when the reply names a third-party `owner/repo` or the session owner cannot be read, since a Tier C filing is never prompted. A bare `#N` in the reply's prose is fed back so the model reissues the reply with a number-link; the detection skips a `#N` inside a fenced code block, inline code, a quote line, or right after `PR` / `pull request`. Built on `hook-decision.ts`, `lane-park.ts`, `filing-cap.ts`, `repo-party.ts` and `run:hold`; fails open, and `stop_hook_active` breaks a block loop. The rows are in `prompts/collaboration-workflow/rule-delivery.md`.

`backlogrun`'s ordinary parent loop and the fetch of the next issue are handled by the supervisor process, so `stop:guard` does not count fetching the next issue toward a block. When a named epic is handed to a headless session for a decision, the lane-child wait protection still applies. Stall and leftover detection runs at the `Stop` event.

### `josh session:lang`

Print the language this session writes in, resolved from `JOSH_SESSION_LANG`. Wired to `UserPromptSubmit` so the value is injected every turn.

```json
{ "type": "command", "command": "pnpm josh session:lang", "timeout": 10 }
```

- Read via `process.loadEnvFile` (environment wins). Unset / empty / no-`.env` resolve to `ja`; `JOSH_SESSION_LANG=en` opts into English.

### `josh e2e:retry-check`

Report whether the preview server process died during a failed E2E attempt. Invoked by the distributed `ci.yml` between the two attempts of its E2E job.

```bash
pnpm josh e2e:retry-check
```

- Reads the preview server debug log (`WRANGLER_LOG_PATH`, default `e2e-web-server-logs`) and matches only when `Error in ProxyController` **and** `Network connection lost.` are in the same file. Verdict written to `$GITHUB_OUTPUT` as `crashed`; a missing/unreadable log ends at "no crash".

## Project

Commands for setting up and maintaining a project.

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

### `josh dogfood:commit`

Make the first commit of a test project a dogfood run created itself. Kit-only.

```bash
pnpm josh dogfood:commit ~/Development/kit-test-html-start
```

An agent's own `git add` / `git commit` is refused wherever it points — the index guard cannot tell a throwaway project from the user's work — so this is the sanctioned route to a dogfood project's `Initial commit`. It runs `git init --initial-branch=main` when the directory has no `.git`, stages everything, commits `Initial commit` and names the branch `main`.

It refuses, changing nothing and exiting `1`, unless the directory:

- is named `kit-test-*` and exists;
- lies outside the kit checkout it is run from;
- has no commit yet, and is not inside another git repository — a `.git` without history, as `sv create` leaves, is accepted.

### `josh sonar:hotspots`

Fetch the SonarCloud hotspots on a pull request and print each one's Step B branch (`excluded` / `local` / `fix` / `defer`); a failed read prints `unreadable`, distinct from finding none. The project key comes from `sonar-project.properties` and the upstream-synced branch key from `sync:scope`'s own detection. Full handling: `prompts/sonar-hotspot-handling.md`.

```bash
pnpm josh sonar:hotspots 42
```

### `josh sonar:new-code`

Fail when a pull request adds any new SonarCloud issue — of any type or severity — or any new duplicated block. It reads the pull request's unresolved issues (`api/issues/search`) and its `new_duplicated_blocks` measure, prints one line per issue and then the verdict: `clean` (exit `0`), `findings: …` or `unreadable: …` (exit `1`) — a failed read fails too, so an outage never passes a pull request as clean. An issue resolved in SonarCloud as accepted or a false positive is not counted. `SONAR_TOKEN` is sent when set. The distributed `sonar-qube.yml` runs it after the scan on every pull request; full handling: `prompts/sonar-hotspot-handling.md`.

```bash
pnpm josh sonar:new-code 42
```

### `josh ui:routes`

List the screenshot-target routes the change touches: a changed `+page` / `+layout` gives its own route, a changed shared component the routes that import it (a one-level `src/routes` scan). Empty output prints "no route derived" rather than guessing; the `verify-ui` skill's §1 narrows the list.

```bash
pnpm josh ui:routes            # the branch diff
pnpm josh ui:routes --staged   # the staged diff instead
```

### `josh propagate`

Carry the release this repository just published into every consumer repository checked out next to it. Runs only from the clean, up-to-date default branch of kit or a CLI-shipping toolkit (app-kit, game-kit); waits for the exact published version to appear in the registry before touching any consumer.

Staged delivery: kit → app-kit → joshuafolkken-com / game-kit → waneccha. A toolkit also carries its base packages, pinned to its installed versions. Each consumer is delivered by the topmost toolkit it installs; lower runs report it `skipped`, naming that toolkit.

```bash
pnpm josh propagate
pnpm josh propagate --dry-run           # report targets and steps, write nothing
pnpm josh propagate --skip-publish-wait # release already known to be published
pnpm josh propagate --target app-kit    # carry the release into one consumer only
```

**Options:**

- `--dry-run` — report targets and steps without writing; skips the publish wait, opens no issues.
- `--skip-publish-wait` — skip the registry poll for an already-published release.
- `--target <repo>` — process only that consumer (`app-kit` or `joshuafolkken/app-kit`); the rest are reported `skipped` and left untouched. An unknown, ambiguous or non-dependent name fails before the publish wait, writing nothing.

Per consumer, in order: working-tree check, `pnpm add -D <package>@<version>` per carried package, `pnpm <bin> sync` per carried package (base first), verification gate, open upgrade issue, `pnpm josh git`, return to default branch. One consumer's failure never stops another; each is reported as `propagated`, `failed` (with the step, reason, and what it left behind), or `skipped`.

The opposite direction — one consumer catching itself up from its own checkout — is [`josh adopt`](josh-commands.md#josh-adopt).

## Workflow

AI-assisted git and notification helpers used in the day-to-day development loop.

### `josh pr:classification`

Use one label (see PR template). Bots may omit it; label changes rerun only the `Release classification` workflow (`.github/workflows/pr-classification.yml`), never CI.

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

- `--no-merge` — do the follow-up work but do not merge; leaves the PR open (the only flag that stops the merge). `--merge` is a deprecated no-op. A PR already merged by hand skips the CI wait, the AI-review scan and the merge and runs only the post-merge tail; a completion report already on the Issue is not posted again.
- `--notify-message` — inline completion body; `\n` expands to newlines.
- `--notify-message-file` — read the completion body from a file (`-` reads stdin); use this whenever the body carries a backtick or `$`. Passing both forms is refused.
- `--ai-review-ignore-reason` — reason to dismiss an AI-review finding.

**Live-execution evidence:** a merge is refused when the branch changes a runtime path (`josh test:declared`'s classification) and the PR body lacks a `## 実機証跡` section of a backticked command plus its fenced output (`issue:lint`'s `## 再現` parser). Pass it with `josh git -y --body-file <path>`.

**Behavior:** merging is the default. The CI wait polls every 10 s with a 32-minute budget (`JOSH_CI_TIMEOUT_SECONDS` overrides); any non-success conclusion ends it immediately naming the failure, and a merge conflict (`DIRTY`) ends it on the first poll. CodeRabbit is exempt from the wait, and a skipped check is noted in the completion Telegram. On a merged run only, it closes any completed epic (now cascading up nested epics, so a completed parent closes too), confirms the Issue closed — closing it with a comment when GitHub did not apply `closes #N` — removes `in-progress`, flushes the observation ledger, ends the progress watcher, and lists up to five next-run candidate issues. Give the tool call its longest timeout — the wait can outlast a single call and `&` backgrounding does not survive.

**Output / exit codes:** exits non-zero naming the failing check on a red run; prints a per-stage timing block (`followup stage: <name> <n> s`) on both success and failure.

Related: [`josh git`](josh-commands.md#josh-git), [`josh observations:flush`](#josh-observationsflush), [`josh time`](josh-commands-run.md#josh-time).

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

**Output / exit codes:** a send that reached nobody exits non-zero, naming the missing variables or the HTTP status (never the token values). `.env` is read via `--env-file-if-exists`. Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, or [`JOSH_NOTIFY=off`](environment-variables.md#notification-behavior) to skip.

### `josh observations:flush`

Commit the observation ledger lines no run's own commit carried (`docs/maintainers/observations/`) as a docs-only pull request of its own (no `closes #N`), wait for the required checks, merge it, and return to the default branch. A run needs none — a lane's included: `josh git` stages the run's own `<N>.md` with its commit when its grammar holds, and `pnpm josh followup` commits a line appended after that onto the pull request before it merges. What is left here is a line written on the default branch outside any issue's run, in a date-named `<YYYY-MM-DD>.md`.

```bash
pnpm josh observations:flush
```

**Behavior:** refuses off the default branch (naming `pnpm josh main:sync`) and refuses when the working tree holds any change besides the ledger (listing those paths). When the ledger matches the commit it sits on it prints `clean` and exits 0. A commit the pre-commit hook rejects is rolled back and its branch removed; a leftover flush branch that holds a commit is landed first, one holding none is discarded. A single run's `pnpm josh run:tail` runs it after the merge, so it is rarely typed by hand. **It acts on the checkout it runs in**: a lane's lines merge with the lane's own pull request, so a lane is refused like any feature branch, and nothing flushes at `pnpm josh run:carry --end` any more.

Related: [`josh followup`](#josh-followup).

### `josh measure:rerun`

Re-run a behavior-change Issue's declared baseline after it merges and print the before/after pair. It reads the Issue's `## ベースライン` section, runs each `` `<command>` → <value> `` entry, and prints the recorded value beside the re-measured one — the merge-time re-read a prose rule never gets.

```bash
pnpm josh measure:rerun 2212
```

**Trust:** a baseline is shell, so it runs only for an `OWNER` / `MEMBER` / `COLLABORATOR` author; any other author, or an unreadable issue, exits 1 before any command runs. A command over its one-minute budget prints `(command failed: …)` and the rest still run.

**Behavior:** when a value has not moved, the premise the rule rested on is recorded as refuted — one line appended to the observation ledger (`docs/maintainers/observations/`, in the file for the issue the checked-out branch leads with, or a date-named file outside any issue's branch), keyed to the command so a second refutation of the same measurement is a same-key repeat the promotion rule counts. It reuses that append-only ledger rather than a second one. A section written in prose (no `` `command` → value `` line) is refused, since a natural-language measurement cannot be re-run. `pnpm josh observations:flush` is the ledger's commit path.

Related: [`josh observations:flush`](#josh-observationsflush), [`josh issue:lint`](#josh-issuelint).

### `josh review:record`

Record a `/code-review` round's findings so they survive the run. It appends one `- rf:<category> | <severity> | <file> | <date> | #<issue>` line per finding to the issue's own file of the observation ledger (`docs/maintainers/observations/<N>.md`, in the work tree the command runs in — a lane's inside a lane) — the same append-only ledger the observation lines use, under a distinct `- rf:` prefix so the `- k:` grammar never treats a finding as its own. It is the one write path for findings.

```bash
pnpm josh review:record --issue 2325 bug-risks:medium:src/foo.ts:42 tests:low:a.test.ts
pnpm josh review:record --issue 2325          # a zero-finding round — records one `none` line
pnpm josh review:record --check --issue 2325  # the merge gate: was it recorded?
```

**Behavior:** each positional is `<category>:<severity>:<file>`, split on its first two colons so a `:line` citation stays in the file field. The category must be one of the nine review-rubric categories and the severity one of `high` / `medium` / `low`, or the call is refused. A call with no findings writes a single `- rf:none | none | - | <date> | #<issue>` line, so a round that found nothing is recorded rather than mistaken for a round nobody reviewed. Both the append and `--check` use the primary checkout's ledger, even when run in a lane — a lane's own copy never reaches the default branch. `pnpm josh observations:flush` commits the appended lines like any other ledger change.

**`--check --issue <N>` is the merge gate** [`josh followup`](#josh-followup) runs: a `- rf:` line for the issue is `ok`, its absence is `missing`, no ledger `not-required`.

Related: [`josh review:findings`](josh-commands.md#josh-reviewfindings), [`josh observations:flush`](#josh-observationsflush).

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

Release everything main has taken since the version last changed — one command, run by a person. It counts merges on `origin/<default>`'s first-parent line since the last version change, raises the version by that many minors, opens and merges a `release/v<version>` pull request, then polls for the `v<version>` tag, the npm publish and the GitHub Release. Each stage reached prints one line, with a link where there is one; the completion line prints only when every stage is reached:

```text
📝 Release PR opened: https://github.com/<owner>/<repo>/pull/<N>
🔀 Release PR merged: https://github.com/<owner>/<repo>/pull/<N>
🏷 Tag vX.Y.Z created
📦 Published to npm: https://www.npmjs.com/package/<name>/v/X.Y.Z
📰 GitHub Release created: https://github.com/<owner>/<repo>/releases/tag/vX.Y.Z
🎉 Release vX.Y.Z complete
```

A package whose `package.json` says `private: true` is not published to npm, so its npm stage is skipped.

```bash
pnpm josh release
pnpm josh release --dry-run   # count and report, write nothing
```

**Runs in its own work tree, never the root checkout.** The count is read from `origin/<default>`, and the version bump, commit and push happen in a dedicated linked work tree cut from `origin/<default>` as the `release/v<version>` branch (placed under the same `.<repo>-lanes/` sibling directory the lanes use, named `release` so it collides with no lane). The tree is removed whether the run succeeds or fails, and its local release branch with it. Because the root is never touched, a release can run beside a [`backlogrun`](how-to/run-issues.md) and can start even when the root is dirty or sitting on another branch. The commit goes through lefthook's pre-commit, so the work tree gets its own dependency install (the hook is never disabled to skip it).

**Options:**

- `--dry-run` — count and report only; writes nothing, fetches nothing, and creates no work tree.
- `JOSH_RELEASE_TAG_TIMEOUT_SECONDS` (env) — tag-watch budget, default 30 minutes.
- `JOSH_RELEASE_NPM_TIMEOUT_SECONDS` (env) — npm-publish watch budget, default 30 minutes.
- `JOSH_RELEASE_GITHUB_RELEASE_TIMEOUT_SECONDS` (env) — GitHub Release watch budget, default 30 minutes.

**Output / exit codes:** exits 0 and writes nothing when the pending count is zero; exits non-zero if `origin/<default>` cannot be read, no version base can be found, the `release/v<version>` branch is already taken (locally or on origin), or a watched stage — the `v<version>` tag, the npm version, the GitHub Release — never appears, which prints that stage with ❌.

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

### `josh release:github`

Create the GitHub Release for a tag `josh release` cut, with notes generated from `.github/release.yml`. Run by CI, not by a person: kit's own `publish.yml` runs it in its `create-release` job, and every consumer receives `.github/workflows/github-release.yml` from `josh init` / `josh sync`, which runs it when `auto-tag.yml` announces the tag (`new-tag-created`) and, in a repository with a `publish.yml`, waits there for the consumer's `Publish <tag>` run to succeed before releasing (a `workflow_run` on `Publish` never fires for a run the `GITHUB_TOKEN` started).

```bash
GH_TOKEN=… RELEASE_TAG=v1.2.0 GITHUB_REPOSITORY=owner/repo pnpm josh release:github
```

| Environment             | Meaning                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `GH_TOKEN`              | Token with `contents: write` and `actions: read`. Required                                              |
| `RELEASE_TAG`           | The tag to release. Required                                                                            |
| `GITHUB_REPOSITORY`     | `owner/repo` to release in — set by GitHub Actions. Required                                            |
| `RELEASE_START_TAG`     | Last tag before automatic releases. Unset: the latest release is the floor; none: the nearest lower tag |
| `RELEASE_WORKFLOW`      | Publish workflow (file or id) whose failed run for a lower tag skips it. Unset: wait for its release    |
| `RELEASE_JOBS`          | Comma-separated jobs in that workflow whose failure counts. Unset: any failed job                       |
| `RELEASE_AWAIT_PUBLISH` | `true`: wait for the tag's own `Publish <tag>` run in `RELEASE_WORKFLOW` to succeed; skip when it fails |

Releases are created in version order: a later tag waits for the nearest lower tag above the floor to get its release, and skips it when that tag's publication failed. A tag that already has a release is left alone. The consumer's release workflow needs the `.github/release.yml` categories and a `Publish` workflow titled `Publish <tag>` (`run-name`) when it has one.

**Output / exit codes:** prints `published <tag> from <baseline>` or `already-published`; exits non-zero on an API error, an invalid tag or repository, a latest release that is not older than the tag, or a lower tag that never gets a release within the wait budget.

## Maintenance

### `josh ruleset:check`

Check that the default branch requires every status check kit's distributed workflows report.

```bash
pnpm josh ruleset:check           # report only
pnpm josh ruleset:check --apply   # add the missing checks to the existing rule
```

A distributed workflow's check gates nothing until the repository requires it — a per-repository setting. `ruleset:check` reads the default branch's rules — its rulesets first, classic branch protection when no ruleset requires a check — and compares them with the checks of the distributed workflows the repository actually has:

| Workflow                                  | Checks                                          |
| ----------------------------------------- | ----------------------------------------------- |
| `.github/workflows/ci.yml`                | `Checks`, `Detect E2E`, `E2E`, `Security Audit` |
| `.github/workflows/sonar-qube.yml`        | `SonarQube`                                     |
| `.github/workflows/pr-classification.yml` | `Release classification`                        |

A workflow the repository does not have contributes nothing. `E2E` is safe to require without an E2E suite: the job is skipped then, and a skipped required check passes. Checks the repository requires beyond these are left alone.

It exits `0` when every expected check is required and `1` otherwise — when one is missing, nothing requires checks at all, or the rules could not be read (a failed read is never reported as missing).

**Options:**

- `--apply` — append the missing checks to the ruleset's required-checks rule (or to the branch protection's contexts). It never creates a ruleset: with none, create one under Settings → Rules → Rulesets, then rerun. Writing a repository setting needs admin access, so only this flag writes — `josh sync` and `josh doctor` never do.

### `josh overrides`

Check that the dependency overrides have not drifted after a dependency update.

```bash
pnpm josh overrides           # verify overrides unchanged
pnpm josh overrides --save    # snapshot current merged overrides
```

Checks effective overrides from `pnpm-workspace.yaml` against a saved snapshot and reports ignored `pnpm.overrides` entries in `package.json` separately. pnpm 11 and 12 do not apply the package field. An empty `pnpm.overrides` is never treated as "no overrides" without reading the workspace.

**Options:**

- `--save` — write the current merged overrides to `.overrides-snapshot.json` (gitignored); later runs compare against it and exit non-zero on any add, removal, or change.

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

Update pnpm with its self-update command, update all dependencies to latest, and run a security audit.

```bash
pnpm josh latest            # full update (pnpm + update + audit)
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

Updates pnpm and pins `packageManager` to the newest release on the project's **current major** (from `packageManager`, or from `devEngines.packageManager.version` when that is the only pin). The command name is retained for compatibility. With an existing `packageManager` pin, it obtains the release integrity value, runs `pnpm self-update`, then restores the integrity suffix and aligns `devEngines.packageManager.version` byte-for-byte with `packageManager`. Without that pin, it adds a verified pin and checks that the selected pnpm version starts. If the registry cannot answer or that version cannot start, the bump is skipped; existing `devEngines` drift may still be aligned to `packageManager`.

#### `josh latest:update`

Runs `pnpm update --latest`, skipping **held-back** and **overridden** packages (effective overrides read from `pnpm-workspace.yaml`) — `typescript` is currently held at `6.x`. Skipped packages print as `⏭ Skipping held-back / overridden packages: …`. If any direct dependency would move down, it restores `package.json` and `pnpm-lock.yaml` to what it found and exits `0`. Otherwise it also advances a pinned `@aikidosec/safe-chain@<version>` in `preinstall` to the newest release, and moves the `SAFE_CHAIN_INSTALLER_VERSION` / `SAFE_CHAIN_INSTALLER_SHA256` env with it, in every workflow under `.github/workflows` and `templates/workflows` and every local composite action under `.github/actions` that carries the pin — in kit itself, the `.github/actions/setup-pnpm` action every workflow installs through, the distributed `ci.yml` included — the hash is computed from that release's `install-safe-chain.sh`, and a failed download leaves the workflows' pins untouched (the `preinstall` pin still advances, and the next `josh latest` retries).

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

Runs the unit suite for the pre-push hook, reusing the result when [`josh gate`](josh-commands.md#josh-gate) already recorded that exact tree green. Wired in by `lefthook/base.yml` as the pre-push `test-unit` command. Reuse requires the gate's file map, base commit and non-empty record to match, plus an empty `git status --porcelain` so the pushed HEAD equals the verified tree; otherwise the whole suite runs. A project with no vitest prints a skip notice; one with vitest but no test file fails.

```bash
pnpm josh pre-push-unit
JOSH_PRE_PUSH_FORCE=1 git push             # run the suite even on a tree recorded green
```

**Output:** on reuse, prints that the tree is already green and nothing was re-run.

### `josh reserved-run`

Runs a command while holding a place in the machine-wide core budget ([`josh gate`](josh-commands.md#josh-gate)'s ledger, `scripts/gate/core-budget.ts`). Wired in by `lefthook/base.yml` as the pre-push `setup` install and the `audit` command, so both count toward the same budget the gate's checks reserve from — eight lanes pushing around the same time no longer spike a machine the gate thought it had to itself.

```bash
pnpm josh reserved-run 2 -- pnpm install       # hold 2 cores while installing
pnpm josh reserved-run 1 -- pnpm josh audit    # hold 1 core while scanning
```

- `<weight> -- <command...>`: the cores to reserve, then the command to run while holding them. The weight is the caller's — a conservative reservation for these two, not a measurement.
- Claims a place before the command starts and waits while the budget is full, exactly as a gate check does; the place is released when the command exits, on success or failure, and its exit code is forwarded.
- A missing separator, a non-integer weight, or no command is a usage error (exit `1`) — a pre-push command that ran unguarded would be the bug this removes.

### `josh pre-commit-type-check`

Type-checks the whole project for the pre-commit hook, reusing the result when [`josh gate`](josh-commands.md#josh-gate) already recorded that exact tree green. Wired in by `lefthook/base.yml` as the pre-commit `type-check` command; runs `pnpm exec tsc --noEmit` when it runs. Reuse requires the gate's file map, base commit and non-empty record to match, that every `git status --porcelain` entry be fully staged (so the committed index equals the verified tree), and that the gate's type-check step be `tsc --noEmit` (projects using a `josh-app` / `josh-game` `check:ci` shim always run the full check). Nothing is forwarded to `tsc`; an argument other than `--force` is refused.

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

Attribute each block by its `issue:` line, never by position. Output past the Bash cap is written as part files under it, and only their paths are printed — read every part with the Read tool in one turn. A number that resolves to nothing prints `does not resolve`; a failed read prints `could not read`; non-zero exit if any number went unanswered. Any non-numeric token refuses the whole call.

### `josh issue:state`

Print each issue's state, labels and whether a run must stop on it, in the spelling the workflow documents compare against.

```bash
pnpm josh issue:state 42                                   # single-number shape
pnpm josh issue:state 42 43 44                             # each block headed by `issue:`
pnpm josh issue:state 42 43 --repo joshuafolkken/app-kit   # a child in another repo
```

**Options:**

- `--repo <owner/repo>` — read a child in another repository; applies to every number.

State is `OPEN` / `CLOSED` / `MERGED`. `human_review:` answers whether the issue carries `needs-human-review`, matched case-insensitively. Output past the Bash cap is written as part files under it, as `issue:read` does. A number that resolves to nothing prints `does not resolve`; a failed read prints `could not read`; non-zero exit if any went unanswered.

### `josh issue:scout`

Before an issue is filed, answer the two questions every filing asks: has this already been filed, and which epic does it belong to. [`josh issue:file`](#josh-issuefile) runs this scan as a filing step and holds the filing until every candidate is named in `--distinct`.

```bash
pnpm josh issue:scout "Stop the gate re-running after every edit"
pnpm josh issue:scout "<title>" --body "follows on from #1246"
pnpm josh issue:scout "<title>" --body-file draft.md
```

**Options:**

- `--body "<text>"` — supply prose references (`#N`) so the epic half has a number to work from; without one it prints `Epic: not asked`.
- `--body-file <path>` — pass the whole draft, including its purpose, requirements and acceptance criteria. A file that cannot be read ends the command rather than being treated as "no candidates".

The duplicate half scores titles by token overlap; a candidate needs ≥2 significant shared words and similarity ≥0.35. An issue the body references explicitly is a candidate too, even when its title is not similar. An incomplete search prints `Duplicates: incomplete`. The epic half is [`josh epic:bundle`](#josh-epicbundle)'s decision, and does not replace it.

### `josh issue:file`

The one path for filing an issue. It runs every filing step, in order. A direct filing through `gh api …/issues` or `gh issue create` is refused every time by the `direct-filing` guard, which points to this command.

```bash
pnpm josh issue:file "<title>" --body-file body.md --depth 1
pnpm josh issue:file "<title>" --body-file body.md --depth 0 --route tier-a --repo joshuafolkken/kit
pnpm josh issue:file "<title>" --body-file body.md --depth 1 --distinct 2801,2795
```

**Options:**

- `--body-file <path>` — the body. Required.
- `--depth <0|1|2>` — the depth label. Required. The criteria are `.claude/skills/workflow-commands/observation-filing.md` → "The depth test".
- `--route <tier-a|split|interrupt|review-cap>` — the `route:` label naming the filing route. Omit it for a filing with no route.
- `--label <name>` — an extra label (for example `epic`). Repeatable.
- `--repo <owner/repo>` — the target repository. Defaults to this repository.
- `--distinct <N,…>` — duplicate candidates you read and judged distinct.
- `--over-cap` — the run is blocked by this filing; the cap lets it through.
- `--no-auto-ok` — needs a person's judgement (Tier B / C); no `auto-ok`.

**Steps (run in this order):**

1. Refuse when the target is third-party (Tier C).
2. Check the body against the same criteria as [`josh issue:lint`](#josh-issuelint). Refuse on any problem.
3. For another repository, confirm `## Origin` names the originating issue (`owner/repo#N` or a URL). Refuse when it does not.
4. Count the target's open issues and print `wip: <count> open in <owner/repo> · cap <cap> · <verdict>`: `within` up to the cap; past it `exempt` (route `interrupt` / `split` / `tier-a`, or `--over-cap`), else `held`, which asks the exemption question and refuses; an unreadable count warns.
5. Run the same duplicate search as [`josh issue:scout`](#josh-issuescout) and print its report. While there are candidates, file nothing until every one is named in `--distinct`. A duplicate is not filed; it is folded into the existing issue by `issue-fold-existing.md`. A filing to another repository points `GH_REPO` at the target, so the duplicate search and the epic decision run there.
6. Create any missing workflow label (depth / route) with its color and description — the same set as [`josh sync`](josh-commands.md#josh-sync). A label that cannot be created is printed with a warning, and the filing goes on.
7. Print the `auto-ok` decision (applied in a `backlogrun` or when the branch's issue has it). File with all labels in one request; print the URL.
8. Run [`josh epic:bundle`](#josh-epicbundle) on the filed issue. When it gives no answer, print `⚠` with the command to re-run. The issue already exists, so the exit code stays 0.

A refusal in steps 1–5 files nothing and exits 1. The per-run filing cap (`filing-cap`) and the `issue:fold` required before a second filing (`issue-fold`) apply to calls of this command. A refused call is not counted.

### `josh issue:fold-existing`

After the existing issue and the draft have been read — bodies, comments, state, pull requests and dependencies — return `duplicate` / `fold` / `separate` / `inspect` from that assessment record. It only decides; it never updates the issue.

```bash
pnpm josh issue:fold-existing assessment.json --json
```

The JSON carries `content` (`duplicate` / `compatible` / `separate` / `unknown`), `is_open`, `is_unstarted`, `has_pull_request`, `has_complete_read`, `has_dependency_conflict`, `is_separable`, `size_verdict` (`single` / `split`), `existing_body`, `draft_body` and `verification`. Omit any fact you do not know; the answer is then `inspect`. Only on `fold` does the output JSON's `body` carry the proposed addition, with the original body kept. Confirm the original body and comments have not changed since the assessment, update through REST, and re-read with `pnpm josh issue:read <N>`. `separate` returns to the ordinary filing path.

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

Post one comment to an issue (a PR comment is an issue comment over REST) with the body passed by path, and print the comment URL. It is the write side the read commands lacked — before it, every park, decision record and plan comment fell to a raw `gh api … body=@<path>`, where `-f` / `--raw-field` sends the literal `@<path>` and `-F` / `--field` reads the file, one character apart and silent when wrong. One command removes the choice.

```bash
pnpm josh issue:comment 2304 --body-file /tmp/park.md   # the body from a file — no shell evaluates it
pnpm josh issue:comment 2304 --body "a short note"      # inline, for a body with no backticks or $
```

**Options:**

- `--body <text>` — the comment body, inline. Trimmed, with `\n` expanded to a newline.
- `--body-file <path>` — read the body from a file, or from stdin with `-`. The safe form the rule steers every caller toward.

The body travels through [`cli-body.ts`](../scripts/josh/cli-body.ts), shared with `notify` / `followup`, so no shell evaluates it; `--body` and `--body-file` at once is refused rather than ranked. `pnpm josh rule:guard` refuses the `-f body=@…` misfire before it runs (the `raw-field-body` row), so the literal `@<path>` cannot reach GitHub.

### `josh pkg:scout`

Before the Package-First tier decision, rank candidate packages by measured metrics so Tier A ("clearly best") and Tier B ("genuine toss-up") are read off the output rather than judged. It queries the npm registry and prints one line per candidate: npm score, weekly downloads, last publish, bundled-types mark, license and unpacked install size.

```bash
pnpm josh pkg:scout "date formatting" --size 5
```

`--size <n>` sets how many candidates to fetch and rank (default 10). The verdict reads the top two's relative lead `(top − second) / top`: `clear` when the leader is ahead by at least 15% (select it, Tier A), `close` when within it (ask the user, Tier B). A failed per-candidate read leaves that metric blank (`—`).

### `josh issue:lint`

Check an issue body file against the template's four required headings — `## 背景`, `## 現象`, `## 期待結果`, `## 受け入れ条件` — and its bug classification (source: `prompts/collaboration-workflow/issue-template.md`). Run this before filing.

```bash
pnpm josh issue:lint /tmp/issue-body.md
```

Prints `ok` and required labels when headings and either `## 背景` declaration — `- 種別: 不具合` or `- 種別: 非不具合` — are present. Missing or conflicting declarations exit 1. [`josh issue:file`](#josh-issuefile) runs this check as a filing step and applies the labels it prints; a non-bug issue without other labels prints `labels: none`. Headings and declarations must stand alone outside code examples.

A body declaring itself a behavior-change Issue with `- 種別: 振る舞い変更` is additionally held to three headings — `## 発火点`, `## ベースライン` and `## 再現`. The firing point is matched against the delivery table: a hook-deliverable tool (`Bash` / `Edit` / `Read` / `Write` / `AskUserQuestion`) passes, a real but undeliverable tool is a mismatch, and a non-tool name is off the table. The baseline must be `` `<command>` → <value> `` so it is re-runnable; prose is refused. The reproduction must be a backticked command and its actual output in a fenced block (` ``` ` or `~~~`); prose ("確認した") is refused for the same reason — a defect claimed from a reading rather than a reproduction is caught at filing. A code-only Issue is held to none of this. After merge, [`josh measure:rerun`](#josh-measurererun) re-runs the baseline.

### `josh defect:rate`

Print the defect rate of merged work over a window — the number that says whether to add a new mechanism or stabilize.

```bash
pnpm josh defect:rate            # the last 14 days
pnpm josh defect:rate --days 30
```

**Options:**

- `--days <n>` — the window in whole days (default 14, at most 3650). Anything else prints the usage and exits 1.

**Behavior:** the numerator is issues filed in the window with `- 種別: 不具合` or `route:interrupt`; the denominator is completed issues with `- 種別: 振る舞い変更`. Filing lint now requires an explicit bug decision; older undeclared defects count only through `route:interrupt`. With no completed behavior change, prints `n/a`. The search API returns at most 1000 results; beyond that the counts are lower bounds. An unreadable search exits 1. `backlog:next` uses this rate to prioritize defects.

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

Prints `ok` (exit 0), or the violations one per line (exit 1). The judgement half — whether the overview names a concrete subject — is left to the writer, because a machine cannot answer it.

### `josh stash:pop`

Pop the stash whose message matches, and no other. The stash is a repository-wide stack every work tree shares, so a bare `git stash pop` — or a positional `stash@{n}` read before another lane pushed — takes whichever entry now sits on top; that is how one lane's parked work reached another's tree. This resolves the selector from the message immediately before the pop, targeting the entry itself rather than a position that moves.

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
- `--lanes` — print one issue number per free lane (requires `--repo`); `JOSH_LANE_LIMIT` sets the ceiling, default 6. Prints `triage` instead while any candidate carries neither `run:solo` nor `run:lane` (the triage gate in [`josh backlog:next`](#josh-backlognext)).

Several leading epic arguments merge into one candidate pool per repository. A cross-repository dependency resolves only when the blocker is closed **and** its declared version has published. `run`/`wait`/`stop`/`complete` exit `0`; an unusable graph (cycle, or body/relations disagreement) exits `1`.

### `josh epic:bundle`

Say whether a newly filed issue belongs with ones already in the backlog. It finds candidates and recommends; it writes nothing. [`josh issue:file`](#josh-issuefile) runs it on the issue it creates as its last filing step.

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

Print the next opted-in standalone issue an unattended run may pick up outside an epic. Read-only; ranks `priority:high` first, then a verification-path defect (`bug` with `run:solo`, or `route:interrupt`), then issues other open issues wait on, then newest-first, skipping `epic`, `in-progress`, `needs-decision` and any candidate whose `blockedBy` is still open.

```bash
pnpm josh auto-ok:next
pnpm josh auto-ok:next --exclude 906   # skip the issue just merged
# create the label once, where wanted:
gh api repos/{owner}/{repo}/labels -f name=auto-ok -f color=0e8a16 -f description="Opted in to unattended execution outside an epic"
```

- `--exclude <N>` — drop issues from the answer; comma-separated, repeatable.

stdout is one token — the issue number, or `none`, or empty with exit 1 if the listing could not be read; explanations to stderr.

### `josh backlog:next`

Order the whole opted-in backlog in one command — standalone `auto-ok` issues plus the descendants of every epic whose root carries `auto-ok`, followed transitively through nested epics. Read-only. Tokens are bare numbers scoped to the repository.

```bash
pnpm josh backlog:next
pnpm josh backlog:next --exclude 1630  # skip the issue just merged
```

- `--exclude <N>` — drop issues from every bucket; comma-separated, repeatable.

stdout is one token per line (all exit 0 unless noted): `<number>…` (each an issue a run may start, possibly in parallel), `wait` (resolves on its own), `stop` (needs a person), `triage` (a candidate is untriaged — see below), `retry` (429/5xx or a request that never arrived), `error` (an unusable graph; anything GitHub answered with, 403 included), `none` (nothing opted in), or empty with exit 1 if a listing could not be read. Explanations to stderr.

**Triage gate**: a candidate is triaged when it carries `run:solo` (runs alone) or `run:lane` (may run beside others), matched case-insensitively. When any candidate of this repository carries neither, the command prints `triage` and no numbers — an untriaged issue may be one that must run alone, so none of the others may start either — and names the untriaged issues on stderr. `backlog:offer` maps it to the budget answer `untriaged`, `backlog:budget` answers `triage`, and `backlog:drive` hands it back to the parent. The gate runs before the `run:solo` gate below. `epic:next --lanes` applies it to a named epic's lanes too.

**Defect priority**: on a `run` answer the command measures `defect:rate` over its default 14 days. While the rate is strictly above the baseline (0.42, `BASELINE_RATE` in `scripts/issue/defect-rate.ts`), the runnable numbers are re-ordered — defects (`- 種別: 不具合` or `route:interrupt`) first, new mechanisms (`- 種別: 振る舞い変更` without either) last, everything else in between — each kind keeping the graph's order. At or below the baseline, or when the rate cannot be read (noted on stderr), the order is unchanged. Only the order within the runnable set changes, so no dependency is crossed.

**Ranking**: after the defect priority, this repository's runnable numbers are sorted by three keys, the earlier order breaking ties — `priority:high` first, then a verification-path defect (`bug` with `run:solo`, or `route:interrupt`), then the number of open backlog issues blocked by it. The `run:solo` gate below sees the whole ranking; only then are the standalone (non-epic) numbers cut to five, and a number past the cut is listed as waiting.

**`run:solo` gate**: on a `run` answer the command reads the repository's open `in-progress` issues (parked ones excluded) and applies three rules. While a `run:solo` issue is running, it prints `wait`. When nothing is running, a `run:solo` candidate at the head is printed alone. A `run:solo` candidate further down cuts the list, so only the candidates ahead of it are printed. While other lanes run, a `run:solo` candidate at the head prints `wait`. The label does not move a candidate up the ranking. When the listing cannot be read, or was cut short, it prints `wait`. The reason goes to stderr. `epic:next --lanes` applies the same gate to a named epic's lanes. `backlog:plan` is not gated, but it marks such rows `[run:solo]` and rows with neither label `[untriaged]`.

### `josh backlog:plan`

The whole backlog rendered as a plan a person reads before a run starts — four sections on stdout, using `backlog:next`'s own classification. Separate because that command's stdout is bare tokens a loop branches on.

```bash
pnpm josh backlog:plan
pnpm josh backlog:plan --exclude 1630  # after #1630 merged
pnpm josh backlog:plan --waves         # the run order, wave by wave
```

- `--exclude <N>` — same exclusion as `backlog:next`.
- `--waves` — print the order the run takes instead of the sections. It assumes each wave merges before the next one starts, leaves out issues a run already has, and plans only this repository. Wave 1 is what `backlog:next` prints for an idle repository; each later wave marks the earlier ones closed and applies the same classification and `run:solo` gate again. A wave of several issues is marked `(parallel)`. Issues no wave reaches are listed last with their reason. Read-only, and refused with named issues or `--only`.

```text
Wave 1  #2770 [run:solo]
Wave 2  #2765 [run:solo]
Wave 3  #2774 #2766 #2769   (parallel)
```

Sections: **Ready now** (runnable children, grouped by repository = the parallelism; a `run:solo` row is marked `[run:solo]`, a row with neither `run:solo` nor `run:lane` `[untriaged]`), **Waiting** (each withheld child naming what it waits on), **Waiting on a person** (`needs-decision` children), **Out of scope** (every open issue the backlog will not run, with the reason).

### `josh backlog:stalled`

Report whether ready backlog work is sitting undispatched while a lane is free and nothing has dispatched for a while — the state where a run is alive but not advancing and nobody notices until a person asks. Reads three facts, weighs none: a runnable count from `backlog:next`, the free-lane count, and the age of the last `child-launch` event on the run's stream.

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

- `--answer <candidates|exhausted|blocked|parked|unreadable|untriaged>` — `backlog:next`'s answer, mapped.
- `--started` / `--active` — when the invocation began / when it last had work (required unless the watch is off).
- `--idle <minutes>` — after candidates run out, keep polling this long (default 30; `--idle 0` turns the watch off).
- `--max <count>` — issues one invocation may take (default unlimited); `--merged` and `--running` count against it.
- `--json` — collapse verdict and reason into `{"budget": "<verdict>", "reason": "…"}`.

stdout is the verdict word (reason to stderr): `run` (start what was offered), `watch` (sleep the interval and ask both again), `stop` (report and finish), `triage` (judge the untriaged issues, then ask again — only after the bound and the maximum), or empty with exit 1 if the invocation is unreadable. The whole-run bound (8 hours) is decided here and outranks both budgets, but a `parked` or `unreadable` answer outranks the bound. A watch polls every 5 min.

### `josh backlog:offer`

A `backlogrun` loop-head event in one call: `backlog:next`, mapped to a budget word, then `backlog:budget`. This section is the single source of the mapping: issue numbers → `candidates`; `wait` → `blocked` with children in flight, `exhausted` without; `none` → `exhausted`; `stop` → `parked`; `triage` → `untriaged`; `retry` → `blocked` below three consecutive asks, `unreadable` at the third (any other answer resets the count); `error`, or exit 1 with empty stdout, → `unreadable` — never `none`, and never re-asked.

```bash
pnpm josh backlog:offer --started "$started" --active "$active" --running 2 --retries 1
```

`--exclude` / `--repo` forward to `backlog:next`; `--started` / `--active` / `--merged` / `--running` / `--max` / `--idle` forward to `backlog:budget` (`--answer` is computed here). `--running` also decides `wait` (→ `blocked` with children in flight, else `exhausted`) and `--retries` decides `retry` (→ `blocked` below three, `unreadable` at the third). stdout is the verdict, then — on `run` — the issue numbers one per line; the new retry count is the last stderr line (`retries: <n>`) and in `--json`. Exit 1 from `backlog:next` maps to `unreadable`, never `none`.

At the drain — a `watch` verdict over an `exhausted` answer with `--running 0` — it marks a `drain` event on the event stream (once per drain, best-effort), so the next `run:step` fires the retrospective before the idle watch. A watch opened while children still merge is left unmarked.

### `josh backlog:drive`

Run the `backlogrun` parent loop as one wait: offer, launch, await, merge, then offer again. It uses the same `backlog:offer`, `lane:launch`, and `run:merge` decisions as the individual commands.

```bash
pnpm josh backlog:drive --owner "$PPID" [--max <n>] [--idle <minutes>] [--only]
```

An open carry record supplies the start time, merged count and remaining named issues. The first stdout line is a hand-back (`merge <token> #N`, `launch #N`, `offer`, `watch`, `triage`, `retrospective`, or `window`), or `stop <reason>` after `run:report` and `run:carry --end`; the second line contains resume flags. The driver merges without the context hand-off check — the supervisor that runs it has no session to cut, so a merge is never handed back as `over` — and it excludes every child still in flight from the offer, so a child that merged its own PR before the loop collected it is never offered for a second launch. A judgment hand-off carries a `Next:` line naming the section to act by and the command that hands the loop back (`run:carry --cut`). A `stop` from `run:merge` is read like the offer's: that child is collected, nothing new starts, and every child still in flight is collected before the run ends as `stop`. A drained backlog yields for the retrospective only when `JOSH_RETROSPECTIVE` is on (the same switch `run:step` reads, loaded from `.env`); with the switch off, or once the retrospective has run, the idle watch continues and a drained `stop` ends the run itself. Named issues are dispatched in their recorded order; `--only` reports and ends after the list. On restart, only lanes with a launch event from this invocation are adopted. A merge is counted once per Issue in the carry record, including when the process stops between counting and the merge event. Launches pass `--stash` while the `josh latest` stash exists.

### `needs-human-review` — the opposite label

The inverse of `auto-ok`: implemented and taken through the verification gate as usual, then nothing is committed, pushed, opened as a PR or merged — the working tree is left uncommitted, a `confirmation` notification carries the resume command, and the run stops. For work no test can judge. Only a person applies or removes it.

```bash
gh api repos/{owner}/{repo}/labels -f name=needs-human-review -f color=d93f0b -f description="Implement and verify, but stop before committing so a person can look"
```

Single source: [`.claude/skills/workflow-commands/needs-human-review.md`](../.claude/skills/workflow-commands/needs-human-review.md).

### `already-done` — the exit for work that is already merged

The exit for a run that verifies its issue's work is already in `main`: nothing to implement, and it cannot close the issue (Tier C). Not `needs-decision` — that waits for an answer; this one has its answer and only the close is outstanding. A run applies it; only a person removes it, by closing the issue.

```bash
gh api repos/{owner}/{repo}/labels -f name=already-done -f color=6f42c1 -f description="Verified already merged — a person closes it"
```

Procedure: [`.claude/skills/workflow-commands/issue-comments.md`](../.claude/skills/workflow-commands/issue-comments.md).

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

| Step                         | Delegatable because                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gate-fix`                   | `pnpm josh gate` re-runs; a wrong fix fails it again, naming the file                                                                                                        |
| `epic-child`                 | the parent reads the child's state from GitHub, so a child reported done but not merged shows as still open                                                                  |
| `followup-filing`            | the parent reads the filed Issue with `pnpm josh issue:state <new>`, so one reported filed but not created shows as absent                                                   |
| `survey`                     | the reported locations are checked directly; a fabricated or missed one fails one `grep`                                                                                     |
| `investigation`              | the parent opens the cited lines; an unsupported conclusion fails there, far cheaper than redoing the reading                                                                |
| `implementation-unit`        | the parent runs the whole change through `pnpm josh gate` and a `/code-review` it would run anyway, so a unit's mistake fails the same backstop a serial edit passes through |
| `lane-failure-investigation` | the `backlogrun` parent opens the cited lines and re-reads the child with `pnpm josh issue:state`; parking, re-dispatching and filing stay with the parent                   |

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

**`investigation` is the only row that carries a threshold, and the threshold is 3 files, and it is a count, not a forecast.** What comes back is the conclusion plus the `file:line` citations that support it, never the file text; a throwaway probe script is written, run and deleted inside the unit. **It is not `survey`, and it is not `diagnosis`**: `survey` reports where something appears and is checked by one `grep`, while a root cause stays with the main line. `pnpm josh delegate --list` prints the count. **A delegation resets the counter rather than spending it**; `josh investigation:guard` does the counting (`docs/maintainers/josh-commands-automation-rationale.md` → "`josh delegate` no longer counts investigation reads").

**The mechanism is not the unit.** **One row covers both batch entry points**: an epic's child and one named issue of a `backlogrun` are the same unit, so both were wired to `epic-child`. **`followup-filing` is a third such unit**: the parent composed the finding text either way, so the unit's work is mechanical. **`implementation-unit` is a fourth**: the writing of one Step 0 unit goes to a subagent while the design that decided _what_ to write stays in the main line, and only file-disjoint units split — `josh fanout` confirms that mechanically, so two subagents never race on one file. Rule: `.claude/skills/workflow-commands/delegation.md`.

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
3. **Launch every unit's subagent in a single turn** — the turn-batching principle (`prompts/collaboration-workflow/turn-batching.md`) reaching the `Agent` launches, not one subagent after another — each briefed with its own files and its slice of the Step 0 table.
4. The main line keeps the design that decided _what_ to write, integrates the returned edits, and runs the one `pnpm josh gate` and `/code-review` over the whole. That gate and review — which the parent runs anyway — is the row's verifier: a unit's mistake fails the same backstop a serial edit passes through, and the disjointness `josh fanout` confirmed keeps two units from colliding on a file. The design stays in the main line, which is why `design` is rejected while the writing is delegated.

### `josh split:assess`

Measure a branch's change size and answer the split assessment's size question. It counts changed files and changed lines against `main`, **excluding test files** (`*.test.ts` / `*.e2e.ts`), and answers `split` only when both guides are exceeded together, `single` otherwise.

```bash
pnpm josh split:assess          # → single
pnpm josh split:assess --json   # the verdict and the reason, machine-readable
```

`split` needs **both** the file guide (10) and the line guide (400) exceeded; either alone, or an empty diff, is `single` — the conservative default of `.claude/skills/workflow-commands/split-assessment.md` → "The question". It answers the **size** question only: separability stays a judgement, so `split` is the size condition met, not a decision to divide the Issue. Untracked files have no diff base — commit before measuring for an exact count.

### `josh oracle:list`

Print the decision oracles — commands that answer a rule question from mechanically readable inputs alone (question 0 of the rule-placement criterion, `prompts/collaboration-workflow/residency.md` → "第 0 問"). Each row carries the command, its answer vocabulary, its **firing point** (or the reason none can be named) and its single-source document. Adding a new oracle means adding a row here and a firing-point declaration in `scripts/rules/oracle-firing.ts`, and nowhere else.

```bash
pnpm josh oracle:list
```

- **The firing point is what makes an oracle enforced**. A declared firing point — the action the oracle must precede — wires a generic `oracle-consulted` delivered rule that refuses that action until the oracle's command has run (`scripts/rules/oracle-consulted.ts`). One is wired: `pkg:scout` (a package add). `issue:lint` no longer has one — [`josh issue:file`](#josh-issuefile) runs the lint as a filing step. `release:scope` is on the reason side, not a firing point: it reads the release owed _after_ `pnpm josh followup` merges, so it trails the merge rather than gating it. The rest declare why no firing point can be named and stay **visibly unenforced** rather than silently so, so a new oracle must always answer whether it has a firing point.
- Single source: `scripts/rules/decision-oracle.ts` (the enumeration) and `scripts/rules/oracle-firing.ts` (the firing points).

### `josh clone:scan`

Count code duplication across files and first-party repos (`JOSH_REPO_PATHS` included) — the measurement `no-clones` lacked. Output: `clean`, or `clones: <N>` then each clone `[same-file|cross-file|cross-repo]` with `file:line` (exit 0). Single source: `scripts/clone/clone-scan.ts`.

### `josh cases`

Read changed paths and print the I/O boundaries the diff crosses (`network` / `process` / `fs` / `none`) and, for each, the mandatory abnormal cases a test declaration must account for (non-200, timeout, empty response, malformed JSON, rate limit). A decision oracle: the unit suite blocks network by design, so these cases are confronted at declaration time. Single source: `scripts/cases/cases-cli.ts`.

### `josh repo:party`

Says whether a repository is **first-party** or **third-party** — computed by owner equality, not
judged. Prints one of `first-party` / `third-party` / `unknown`
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
