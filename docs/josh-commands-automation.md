# josh CLI — Automation Command Reference

The commands a person rarely types: the ones Claude Code hooks, git hooks, the issue-driven workflow runs (`fullrun`, `backlogrun`, …) and lanes call, plus the `maintainer` commands kit's own maintainers run. The run, lane and session commands (`josh run:*`, `josh lane:*`, `josh ship`, `josh cost`, `josh doc:*`, `josh read:*`, `josh edit:files`, `josh time`, `josh retrospective`, `josh eval`) are in [josh-commands-run.md](josh-commands-run.md). The issue, epic, backlog, review and delegation commands (`josh issue:*`, `josh epic*`, `josh auto-ok:next`, `josh backlog:*`, `josh review:brief`, `josh review:round2`, `josh review:attest`, `josh delegate`, `josh fanout`, `josh split:assess`, `josh oracle:list`, …) are in [josh-commands-backlog.md](josh-commands-backlog.md). The commands you type by hand are in [josh-commands.md](josh-commands.md); every command is indexed in the [Command Catalog](josh-command-catalog.md). The issues each command came from: `docs/maintainers/josh-commands-automation-rationale.md` → "Where each command came from".

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
- **The launcher** (`scripts/hooks/run-hook.sh <name> [arguments]`) holds everything the hooks share, once: it clears the git location variables for the hook itself when the root resolves without them, hands the hook to the ready gate, which runs `dist/hooks/<name>.js` once it passes and otherwise runs the live source through `pnpm josh <command>` — the name with its first `-` turned into `:` (`pretool-guard` → `pretool:guard`).
- **The ready gate** (`scripts/hooks/hook-bundle-ready.ts`, run by plain `node`) compares a content digest of the bundle inputs recorded at build time (`dist/hooks/inputs.json`) with the source on disk. Fresh → the bundle runs in the gate's own process, so a hook call starts node once. Stale → it rebuilds `dist/hooks/` in-process (a fraction of a second) and says so on stderr, so an edited guard is never shadowed by its old bundle. A checkout that cannot build drops to the `pnpm josh` fallback with a stderr warning — that path is slow and a hook exceeding its timeout lets the call through unguarded.
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
- The refusal points at the `investigator` agent (`.claude/agents/investigator.md`, shipped through the plugin as `kit:investigator`): `model: sonnet`, with `effort: low` and read-only tools. Excludes the run's own instructions (`CLAUDE.md`, `prompts/`, `.claude/skills/`) and harness session files.
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

- **Direct filing** — trigger is a hand-built filing (`gh issue create`, or a `title`-bearing POST to a path ending `/issues`); refused on every occurrence and pointed at [`josh issue:file`](josh-commands-backlog.md#josh-issuefile), which runs every filing step itself.
- **Issue comments** — trigger reads an Issue body without them (`gh issue view <N>`, or a `GET` ending `…/issues/<N>`); hands over `gh issue view <N> --comments`.
- **Piped verification** — trigger is a josh check (`gate`, `check`, `lint*`, `cspell*`, `test*`, `eval`, `overrides`, `ranges`) standing anywhere but the last pipeline segment.
- **Early heartbeat** — trigger is a `Bash` call whose whole purpose is to wait; `pnpm josh run:progress --once` / `--wait` are exempt.
- **The pre-gate cut row**: the trigger is a `Bash` call that runs `pnpm josh gate` from a **lane** working tree that **has not yet taken its cut**, handing over `pnpm josh run:cut <N>` with what each of its six verdicts obliges. It exists because the step was carried as prose and fired **0 times in 6 lane children**; `--resume`, `--end` and `--json` do not count as taking the cut. `.claude/skills/workflow-commands/pre-gate-cut.md` is the single source of the procedure.
- **The implementation-phase cut row**: the trigger is an `Edit` / `Write` from a **lane** working tree that has not yet taken its cut, once the recent-context verdict (`pnpm josh cost --cut`'s, unmeasurable read `!== UNDER` on the safety-net side) is over the shared threshold, handing over `pnpm josh run:cut --impl <N> --handoff <path>`. Unlike the pre-gate row it **fires on every threshold crossing**: once per run left a `busy` / `failed` verdict to grow the context unwatched, so it carries `decide` and lets an edit reissued right after a refusal through. The verdict read is reused over a few-second per-checkout window. `.claude/skills/workflow-commands/pre-gate-cut.md` is the single source.
- **Bare `pnpm josh git`** — trigger is a `pnpm josh git` with no `-y` / `--yes`; it prompts to confirm the staging, cancels with no TTY, and the run reissues with `-y` after throwing the time away. Hands over `pnpm josh git -y "<title> #<N>"`. Disjoint from the run-tail push row by the flag — that one requires `-y`, this refuses its absence — and it fires on every occurrence.

Set `JOSH_RULE_GUARD` to `off` / `0` / `false` / `no` to disable. Some rows deliver once per run; some — force push / branch delete, direct filing, the bare-`git` and run-tail push rows, and the implementation-phase cut — fire on every occurrence; and a row that asks for an earlier command (the Issue comments, `pkg:scout`, the rule-body placement questions) refuses every call until that command is on the transcript.

### `josh rule:list`

Print the trigger-delivered rules `rule-delivery.md` points at: one item per guard row of `scripts/rules/delivered-rules.ts`, then the `Stop` hook's rows — single source, hook, trigger, silence. The prose comes from `scripts/rules/rule-registry.ts`, joined by `id`; a row with no entry prints as missing and fails `rule-list.test.ts`. A hookless agent reads it as its checklist.

### `josh pretool:guard`

The `PreToolUse` dispatcher that routes each pending tool call to the delivered-rule guards (`batch:guard`, `investigation:guard`, `duplicate-read:guard`, `rule:guard`). A refusal leaves through `hookSpecificOutput.permissionDecision`; an unclaimed call writes nothing.

**How each of the four behaves in a dispatched lane child is an enumeration, not a judgement**. A denial is guidance to an interactive main line but a fatal turn-ender to a headless `claude -p` child, so `scripts/lane/lane-guard-policy.ts` lists, in one place, each guard's three-valued mode for a lane child (`JOSH_LANE_CHILD`) — `refuse`, `notice`, or `off`: `investigation` is `notice` (it names the concrete unedited files rather than refusing), `batching` is `off` (a notice is structurally unable to reach the turn it would pack), `duplicate-read` is `notice` (a refusal would kill the child, and the unchanged re-reads it catches are measured in those very children — so it nudges rather than silences), while `rule` stays `refuse` — it carries the lane-only rules a child depends on (`pre-gate-cut`, `lane-park`) and the safety rules it must still obey. `lane-guard-policy.test.ts` pins that the enumeration and the guards' live behavior cannot disagree.

### `josh codex:hook-adapter`

The Codex counterpart of `pretool:guard` and `format:edited`: `pretool` or `posttool` reads a Codex hook payload on stdin, runs the same guard the Claude Code hook runs, and answers in Codex's hook format. `.codex/hooks.json` launches it as `sh scripts/hooks/run-hook.sh codex-hook-adapter <pretool|posttool>`; this command is the launcher's live-source fallback when the bundle cannot run.

### `josh stop:guard`

The `Stop` hook: one process delivering the four stop-time rules — stop-notification, hold-release, filing-offer and issue-citation all **block** the stop, since `{"decision":"block"}` is a `Stop` hook's one channel to the model. In an unattended run (a headless session kit launched, a lane child, or the `backlogrun` parent), a reply whose prose offers to file an Issue ("起票してよければ", "Shall I file …") on a turn whose transcript tail holds no filing that a guard let through is sent back to file it with `pnpm josh issue:file`, because a first-party filing is Tier A (`observation-filing.md`); it stays silent when the reply names a third-party `owner/repo` or the session owner cannot be read, since a Tier C filing is never prompted, and in an interactive session, where asking before filing is correct. A bare `#N` in the reply's prose is fed back so the model reissues the reply with a number-link; the detection skips a `#N` inside a fenced code block, inline code, a quote line, or right after `PR` / `pull request`. Built on `hook-decision.ts`, `lane-park.ts`, `filing-cap.ts`, `repo-party.ts` and `run:hold`; fails open, and `stop_hook_active` breaks a block loop. The rows are in `prompts/collaboration-workflow/rule-delivery.md`.

`backlogrun`'s ordinary parent loop and the fetch of the next issue are handled by the supervisor process, so `stop:guard` does not count fetching the next issue toward a block. When a named epic is handed to a headless session for a decision, the lane-child wait protection still applies. Stall and leftover detection runs at the `Stop` event.

### `josh session:lang`

Print the language this session writes in, resolved from `JOSH_SESSION_LANG`. Wired to `UserPromptSubmit`; the `ja` default prints nothing.

```json
{ "type": "command", "command": "pnpm josh session:lang", "timeout": 10 }
```

- Read via `process.loadEnvFile` (environment wins). Unset / empty / no-`.env` resolve to `ja`; `JOSH_SESSION_LANG=en` opts into English.
- While a `backlogrun` is live in the repository, it also prints one line telling the session to answer a progress question with `pnpm josh run:board --chat`, so a session that is not driving the run gets the rule too. No run, no line.

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

Commit the observation ledger lines no run's own commit carried (`.josh/observations/`) as a pull request of its own (no `closes #N`), wait for the required checks, merge it, and return to the default branch. A run needs none — a lane's included: `josh git` stages the run's own `<N>.md` with its commit when its grammar holds, and `pnpm josh followup` commits a line appended after that onto the pull request before it merges. What is left here is a line written on the default branch outside any issue's run, in a date-named `<YYYY-MM-DD>.md`.

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

**Behavior:** when a value has not moved, the premise the rule rested on is recorded as refuted — one line appended to the observation ledger (`.josh/observations/`, in the file for the issue the checked-out branch leads with, or a date-named file outside any issue's branch), keyed to the command so a second refutation of the same measurement is a same-key repeat the promotion rule counts. It reuses that append-only ledger rather than a second one. A section written in prose (no `` `command` → value `` line) is refused, since a natural-language measurement cannot be re-run. `pnpm josh observations:flush` is the ledger's commit path.

Related: [`josh observations:flush`](#josh-observationsflush), [`josh issue:lint`](josh-commands-backlog.md#josh-issuelint).

### `josh observation:record`

Count a `- k:<key>` sighting across `.josh/observations/`, append it, and print `file` (the second sighting — file it) or `ledger`; earlier sightings go to stderr. A malformed or `k:example` line is refused with exit 1. `--checkout <path>` uses another repository's ledger. The rule: `.claude/skills/workflow-commands/observation-ledger.md`.

### `josh review:record`

Record a `/code-review` round's findings so they survive the run. It appends one `- rf:<category> | <severity> | <file> | <date> | #<issue>` line per finding to the issue's own file of the observation ledger (`.josh/observations/<N>.md`, in the work tree the command runs in — a lane's inside a lane) — the same append-only ledger the observation lines use, under a distinct `- rf:` prefix so the `- k:` grammar never treats a finding as its own. It is the one write path for findings.

```bash
pnpm josh review:record --issue 2325 bug-risks:medium:src/foo.ts:42 tests:low:a.test.ts
pnpm josh review:record --issue 2325          # a zero-finding round — records one `none` line
pnpm josh review:record --issue 2325 --comment  # a round that passed after the PR opened — an Issue comment, no append
pnpm josh review:record --check --issue 2325  # the merge gate: was it recorded?
```

**Behavior:** each positional is `<category>:<severity>:<file>`, split on its first two colons so a `:line` citation stays in the file field. The category must be one of the nine review-rubric categories and the severity one of `high` / `medium` / `low`, or the call is refused with the usage and the accepted categories and severities, listed from the ledger's own constants. A call with no findings writes a single `- rf:none | none | - | <date> | #<issue>` line, so a round that found nothing is recorded rather than mistaken for a round nobody reviewed. `--comment` posts the same lines as a comment on the issue and appends nothing — for a round that passed after the pull request opened, where a line in the tree would be pushed onto it and restart its CI. Both the append and `--check` use the primary checkout's ledger, even when run in a lane — a lane's own copy never reaches the default branch. `pnpm josh observations:flush` commits the appended lines like any other ledger change.

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
- `--help` / `-h` — print the usage line and exit 0 without fetching or releasing. Any other argument is refused with the usage line and a non-zero exit, before anything is fetched.
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

Releases are created in version order: a later tag waits for the nearest lower tag above the floor to get its release, and skips it when that tag's publication failed, or when its `Publish <tag>` run has completed without a release and no run in `RELEASE_RUN_WORKFLOW` is still at work on it — such a tag never gains a release. A run there is at work on the tag while it is unfinished and titled `GitHub Release <tag>`, or titled without a tag (started before the title named one). A tag that already has a release is left alone. The consumer's release workflow needs the `.github/release.yml` categories and a `Publish` workflow titled `Publish <tag>` (`run-name`) when it has one.

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

### `josh latest:scope`

The update itself — [`josh latest`](josh-commands.md#josh-latest) — is a command you type.

Prints `required` or `skip` on stdout (reason on stderr) — whether this checkout must update. Read the answer with `$(pnpm josh latest:scope)`; workflow commands ask it instead of updating unconditionally. No completion record answers `required` (fresh checkout, cleared temp dir, or a half-finished chain — a failed pnpm bump included, since `latest:corepack` runs right before the record and exits non-zero). The freshness window is **12 hours**, overridable via `JOSH_LATEST_MAX_AGE_HOURS`. The record is per-checkout, and `--record` is the write half used by the chain (prints nothing on stdout).

### `josh latest:guard`

Fronts the `josh latest` chain and refuses inside a lane; a lane's per-root stamp always reads stale.

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
