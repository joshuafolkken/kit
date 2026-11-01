# Environment variables

Every environment variable kit reads, in one place. Set the ones you need in a `.env` file at the project root — `.env` is gitignored, so each value stays on this machine — or as real environment variables, as a cloud session does ([cloud-session.md](./cloud-session.md#environment-variables)). A real environment variable wins over the same key in `.env`.

Only these load `.env` themselves, and only when it exists:

- **Workflow** — `josh notify`, `josh followup`, `josh ship`, `josh backlogrun`, `josh backlog:drive`, `josh epic:next`, `josh upstream:interrupt`, `josh issue:plan`, whose `--planned` sends the planning Telegram, and `josh epic`, whose `--notify` sends the split path's.
- **Run state** — `josh run:entry`, `josh run:hold`, `josh run:release`, `josh run:pause`, `josh run:step`, `josh run:event`, `josh run:carry`, `josh run:board`, `josh run:wake`, `josh run:merge`, and `josh issue:already-done` and `josh issue:measured`, which release the hold.
- **Lanes** — every lane command except `lane:launch`: `josh lane:open`, `josh lane:close`, `josh lane:list`, `josh lane:prune`, `josh lane:output`, `josh lane:dispatch`, `josh lane:await`, `josh lane:limit`, `josh lane:restart`, `josh lane:withdraw`, `josh lane:pause`, `josh lane:resume`, `josh lane:plan`, `josh lane:adopt`, `josh lane:sample`, `josh lane:stats`, `josh lane:value`, `josh lane:net`, `josh lane:breakdown`.
- **Setup** — `josh doctor`, `josh latest:scope`, `josh latest:if-required`, `josh latest:update`, `josh port`, `josh session:lang`.
- **Reports** — `josh report:template`, `josh report:lint` and `josh run:report`, whose labels follow `JOSH_SESSION_LANG`; `run:report --handoff` also sends its report to Telegram.
- **Hooks** — `josh pretool:guard` (the rule, batch, investigation and duplicate-read guards in one process) and `josh stop:guard`; and `josh codex:hook-adapter`.
- `playwright.config.ts`.

`scripts/document/environment-file-reference.test.ts` checks this list against the command registry, both ways.

Every other command — `josh gate`, `josh review:brief`, `josh clone:scan`, `josh release`, `josh eval`, `josh run:progress` and the git hooks among them — reads only the real environment. Set the variables they read (`JOSH_SCOPED_GREEN`, `JOSH_RELEASE_TAG_TIMEOUT_SECONDS`, `JOSH_EVAL_MODEL`, `JOSH_EVAL_CONCURRENCY`, `JOSH_PROGRESS`, the two `*_FORCE` switches) in the shell that runs them.

Set `JOSH_PROGRESS_INTERVAL_MINUTES` in the shell, or commit `josh.progress_interval_minutes` in `package.json`: in `.env` it reaches only the `josh pretool:guard` heartbeat, not `josh run:progress`.

All of them are optional except the two Telegram credentials, which notifications need unless `JOSH_NOTIFY=off`. A blank value (`KEY=`) means the same as leaving the key out.

`scripts/document/environment-variable-reference.test.ts` checks that the `JOSH_*` rows below match the variables the code reads, both ways, so a new variable cannot ship without a row here.

## Variables you set

### Notifications and language

| Variable             | Required                      | Default                                        | Used when                                                                                                                                                            |
| -------------------- | ----------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | Yes, unless `JOSH_NOTIFY=off` | —                                              | Every notification a workflow sends ([how to get it](./how-to/set-up-notifications.md#telegram_bot_token)).                                                          |
| `TELEGRAM_CHAT_ID`   | Yes, unless `JOSH_NOTIFY=off` | —                                              | The chat that receives them ([how to get it](./how-to/set-up-notifications.md#telegram_chat_id)).                                                                    |
| `JOSH_NOTIFY`        | No                            | on                                             | `off` skips every notification with exit code 0 and makes the two credentials unnecessary ([details](#notification-behavior)).                                       |
| `JOSH_NOTIFY_OPT_IN` | No                            | — (neither)                                    | Comma-separated optional types to send, e.g. `planning,completion`; an optional type not listed is skipped with exit code 0 ([details](#notification-behavior)).     |
| `JOSH_SESSION_LANG`  | No                            | `ja` (`josh init` seeds it from the OS locale) | The language of session dialogue, Issue bodies, comments and notification bodies, e.g. `en` ([`josh session:lang`](./josh-commands-automation.md#josh-sessionlang)). |

#### Notification behavior

**A notification that reached nobody is a failure, not a skip.** Missing credentials and a refused request are treated the same way, and what happens next depends only on whose job the notification was.

An explicit `JOSH_NOTIFY=off` is the one exception: it records that nobody is meant to be notified, so every send is skipped with one `🔕 Telegram notifications are disabled` line and exit code 0, and nothing below applies. Only `off` (case-insensitive) disables them: unset or any other value keeps the behavior below, so a forgotten setup still fails rather than passing quietly.

`planning` and `completion` are optional: neither needs anyone to act, so each is sent only when `JOSH_NOTIFY_OPT_IN` names it, and is otherwise skipped with one `🔕 <type> notifications are not opted in` line and exit code 0. Every other type is always sent. To keep receiving both, add `JOSH_NOTIFY_OPT_IN=planning,completion`.

When `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` is missing or empty, or the send itself fails:

- `josh notify` **exits non-zero**. The message names the missing variables, or the HTTP status the API answered with — never the value of either credential.
- `josh followup` **reports the failure and carries on** to the merge, the completion comment and the epic close; only the Telegram delivery is missing. The report is its own `❗` block on stderr, carrying the recovery command where one exists.

A missing `.env` file is not itself an error: both commands also read the two variables from the environment, so a cloud session that sets them there notifies normally. Rationale: `docs/maintainers/environment-variables-rationale.md` → "Why a missing .env no longer stops the notification commands".

### Ports and lanes

| Variable                  | Required | Default                                           | Used when                                                                                                                                                                                                                  |
| ------------------------- | -------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT_SEED`               | No       | `0` (dev 5173, preview 4173)                      | Several kit projects run on one machine: an integer `0`–`99` that moves this project's dev and preview ports by `seed × 10` ([`josh port`](./josh-commands.md#josh-port)).                                                 |
| `JOSH_LANE_ROOT`          | No       | `.<repository-name>-lanes`, beside the repository | Where `josh lane:open` puts a lane's work tree.                                                                                                                                                                            |
| `JOSH_LANE_LIMIT`         | No       | `4`                                               | How many lanes one repository runs at once ([`josh epic:next`](./josh-commands-backlog.md#josh-epicnext)), and a followup relaunch may run one past it; set `2` on a small container.                                      |
| `JOSH_LANE_RESIDENT_APPS` | No       | `Google Chrome.app,Visual Studio Code.app`        | The apps whose summed resident size a `load` sample records and `josh lane:stats` reports, as comma-separated command-line substrings; an empty value in `.env` records none (pnpm drops an empty exported one).           |
| `PLAYWRIGHT_REUSE_SERVER` | No       | off                                               | `1` / `true` / `yes` / `on` lets the E2E run reuse this project's own server already on the port instead of booting one ([troubleshooting](./troubleshooting.md#local-e2e-aborts-with-httplocalhost5173-is-already-used)). |

### Unattended agents

Each role's model and effort for a `backlogrun`. The invoking CLI picks the provider. Model overrides apply to Claude Code only — Codex always runs `gpt-6.1-sol`; effort accepts `low`, `medium`, `high`, `xhigh` or `max` for either provider. A scheduler or worker model set to a consultation model (Fable) is rejected before launch.

Set `JOSH_AGENT_PROVIDER=openai` in the project's `.env` to start `pnpm josh backlogrun` with Codex and its existing role profiles. `anthropic`, an unset value, or a blank value selects Claude Code.

An exported value takes precedence over `.env`; `--agent claude|codex` takes precedence over both. Other nonempty provider values are rejected before launch. This default selects a new run; opening an existing run's board or using `--restart` keeps its recorded provider.

Detached launchers also hand this variable to processes without an agent session. A detected session keeps determining its own provider.

| Variable                            | Required | Default                                            | Used when                                                                  |
| ----------------------------------- | -------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| `JOSH_AGENT_PROVIDER`               | No       | `anthropic`                                        | The default provider for a new `josh backlogrun`: `anthropic` or `openai`. |
| `JOSH_SCHEDULER_MODEL`              | No       | `claude-opus-5-5`                                  | The model of the run that schedules the batch.                             |
| `JOSH_SCHEDULER_EFFORT`             | No       | `medium`                                           | The effort of the run that schedules the batch.                            |
| `JOSH_WORKER_MODEL`                 | No       | `claude-opus-5-5`                                  | The model of each lane that implements an Issue.                           |
| `JOSH_WORKER_EFFORT`                | No       | `medium`, and `low` once the lane reaches the gate | The effort of each lane that implements an Issue.                          |
| `JOSH_WORKER_SHIP_MODEL`            | No       | the worker's model                                 | The model a lane relaunches on once it reaches the gate (the ship phase).  |
| `JOSH_REVIEWER_MODEL`               | No       | `claude-opus-5-5`                                  | The model of the review a lane's change gets.                              |
| `JOSH_REVIEWER_EFFORT`              | No       | `medium`                                           | The effort of the review a lane's change gets.                             |
| `JOSH_REVIEWER_VERIFICATION_MODEL`  | No       | `claude-sonnet-5-5`                                | Round 2 and later verification pass; falls back to `JOSH_REVIEWER_MODEL`.  |
| `JOSH_REVIEWER_VERIFICATION_EFFORT` | No       | `high`                                             | Round 2 and later verification pass; falls back to `JOSH_REVIEWER_EFFORT`. |
| `JOSH_INVESTIGATION_MODEL`          | No       | `claude-opus-5-5`                                  | The model a Fable main line hands broad investigation to.                  |
| `JOSH_LANE_MODEL`                   | No       | —                                                  | Legacy worker-only alias; use `JOSH_WORKER_MODEL` instead.                 |
| `JOSH_LANE_EFFORT`                  | No       | —                                                  | Legacy worker-only alias; use `JOSH_WORKER_EFFORT` instead.                |

### Runs

| Variable                         | Required | Default                                                          | Used when                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | -------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JOSH_PROGRESS_INTERVAL_MINUTES` | No       | `josh.progress_interval_minutes` in `package.json`, else `20`    | How long a run goes quiet before `josh run:progress` prints a line ([`josh run:progress`](./josh-commands-run.md#josh-runprogress)).                                                                                                                                                                                                                                              |
| `JOSH_PROGRESS`                  | No       | on                                                               | `0` turns the progress lines off.                                                                                                                                                                                                                                                                                                                                                 |
| `JOSH_RETROSPECTIVE`             | No       | off                                                              | `on` / `1` / `true` / `yes` runs the end-of-run retrospective when a backlog drains ([`josh retrospective`](./josh-commands-run.md#josh-retrospective)).                                                                                                                                                                                                                          |
| `JOSH_LANE_INVESTIGATION`        | No       | off                                                              | `on` / `1` / `true` / `yes` lets `josh run:merge` launch the overrun and baseline investigations of merged lanes ([`josh run:merge`](./josh-commands-run.md#josh-runmerge)); off, an overrun only notes its skip. Not `JOSH_LANE_OVERRUN`, the mark josh sets inside an investigation session.                                                                                    |
| `JOSH_REPO_PATHS`                | No       | sibling repositories are found automatically                     | A repository that is not a sibling, or is checked out twice: `owner/repo=/absolute/path`, comma-separated ([`josh doctor`](./josh-commands.md#josh-doctor)).                                                                                                                                                                                                                      |
| `JOSH_DEBUG`                     | No       | off                                                              | Any non-blank value writes the error a run, lane, git or GitHub state check swallowed to stderr as `josh debug: <where>: <message>`; verdicts are unchanged.                                                                                                                                                                                                                      |
| `JOSH_TEMP_ROOT`                 | No       | `/tmp` (`os.tmpdir()` on Windows or when `/tmp` is not writable) | The directory every host-wide record goes to; the run state that must survive a reboot (kept in `<common git dir>/josh/run-state/` by default) moves to `<root>/josh-state/` beneath it; a log there not written for 14 days is removed. Point it at a fresh `mktemp -d` to take live evidence of `run:carry` without touching the running run (it does not isolate `run:merge`). |
| `JOSH_CORE_RESERVED`             | No       | unset                                                            | Set by josh, never by hand: `1` marks a child whose parent already holds its share of the machine-wide core budget, so it does not reserve a second time.                                                                                                                                                                                                                         |
| `JOSH_CORE_RESERVATION`          | No       | unset                                                            | Set by josh, never by hand: the ledger key of the claim a command holds for its children, so a unit suite reading the machine's free cores leaves its own not-yet-busy claim out of the ledger.                                                                                                                                                                                   |

### Merge, release and dependency updates

| Variable                                      | Required | Default        | Used when                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | -------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JOSH_CI_TIMEOUT_SECONDS`                     | No       | 32 minutes     | How long `josh followup` waits for CI ([`josh followup`](./josh-commands-automation.md#josh-followup)).                                                                                                                                                                           |
| `JOSH_REQUIRED_CHECKS`                        | No       | `SonarQube`    | The checks a merge waits for, comma-separated.                                                                                                                                                                                                                                    |
| `JOSH_RELEASE_TAG_TIMEOUT_SECONDS`            | No       | 30 minutes     | How long `josh release` watches for its tag ([`josh release`](./josh-commands-automation.md#josh-release)).                                                                                                                                                                       |
| `JOSH_RELEASE_NPM_TIMEOUT_SECONDS`            | No       | 30 minutes     | How long `josh release` watches for its version on npm ([`josh release`](./josh-commands-automation.md#josh-release)).                                                                                                                                                            |
| `JOSH_RELEASE_GITHUB_RELEASE_TIMEOUT_SECONDS` | No       | 30 minutes     | How long `josh release` watches for its GitHub Release ([`josh release`](./josh-commands-automation.md#josh-release)).                                                                                                                                                            |
| `JOSH_LATEST_MAX_AGE_HOURS`                   | No       | `12`           | How old the last dependency update may be before `josh latest:scope` answers `required` ([`josh latest:scope`](./josh-commands-automation.md#josh-latestscope)).                                                                                                                  |
| `JOSH_PLAYWRIGHT_BROWSERS`                    | No       | `chromium`     | The browsers `josh latest:update` installs after it moves `@playwright/test`, space-separated ([`josh latest:update`](./josh-commands.md#josh-latestupdate)).                                                                                                                     |
| `JOSH_METRICS_BASE`                           | No       | the merge-base | The commit `josh metrics` measures the totals from, and `josh lockfile:policy` diffs the lockfile against, where no merge-base can be asked for — kit's CI names `HEAD^1`. A name that resolves to no commit fails the check ([`josh metrics`](./josh-commands.md#josh-metrics)). |

### Git hooks

| Variable                  | Required | Default | Used when                                                                                                                                                                                                                          |
| ------------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JOSH_PRE_PUSH_FORCE`     | No       | off     | `1` runs the pre-push unit suite even on a tree already recorded green ([`josh pre-push-unit`](./josh-commands-automation.md#josh-pre-push-unit)).                                                                                 |
| `JOSH_PRE_PUSH_RELATED`   | No       | off     | `1` runs the related unit tests instead of the whole suite when no green gate record covers the push; set by `josh ship`'s push ahead of the gate ([`josh pre-push-unit`](./josh-commands-automation.md#josh-pre-push-unit)).      |
| `JOSH_PRE_COMMIT_FORCE`   | No       | off     | `1` runs the pre-commit type check even on a tree already recorded green ([`josh pre-commit-type-check`](./josh-commands-automation.md#josh-pre-commit-type-check)).                                                               |
| `JOSH_PRE_COMMIT_LINT`    | No       | on      | `off` skips the pre-commit prettier, cspell and eslint hooks; `josh ship` sets it for its local commit, whose tree the gate checks before the push ([`josh pre-commit-lint`](./josh-commands-automation.md#josh-pre-commit-lint)). |
| `JOSH_SECRETLINT_REQUIRE` | No       | off     | `1` makes `josh secretlint-scan` fail rather than skip when secretlint is not installed; the CI `Secret Scan` job sets it.                                                                                                         |

### Unit tests

| Variable                | Required | Default | Used when                                                                                                                                                                                                       |
| ----------------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JOSH_UNIT_DURATIONS`   | No       | off     | `record` writes each run file's duration into `tools/test/unit-durations.json`, which `josh test:unit --shard=<index>/<count>` balances the shards by (kit only).                                               |
| `JOSH_VITEST_CACHE_DIR` | No       | Vite's  | The Vite cache directory the vitest config uses; `josh test:red` and `josh test:pinned` set it beside their throwaway tree, so its run never rewrites the dependency cache a gate beside it imports (kit only). |

### Agent guards

Each guard is on by default; `off`, `0`, `false` or `no` turns that one guard off.

**Set a guard switch only at launch — `JOSH_RULE_GUARD=off claude`.** A run can write `.env`, so kit ignores a `JOSH_*_GUARD`, `JOSH_*_FORCE` or `JOSH_SCOPED_GREEN` line there.

| Variable                    | Required | Default | Used when                                                                                                              |
| --------------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| `JOSH_BATCH_GUARD`          | No       | on      | [`josh pretool:guard`](./josh-commands-automation.md#josh-pretoolguard) — calls that could have gone out together.     |
| `JOSH_INVESTIGATION_GUARD`  | No       | on      | [`josh pretool:guard`](./josh-commands-automation.md#josh-pretoolguard) — reading too much before delegating.          |
| `JOSH_DUPLICATE_READ_GUARD` | No       | on      | [`josh pretool:guard`](./josh-commands-automation.md#josh-pretoolguard) — reading the same file twice.                 |
| `JOSH_RULE_GUARD`           | No       | on      | [`josh pretool:guard`](./josh-commands-automation.md#josh-pretoolguard) — a rule delivered at the call that breaks it. |
| `JOSH_STOP_GUARD`           | No       | on      | [`josh stop:guard`](./josh-commands-automation.md#josh-stopguard) — what a turn must do before it ends.                |
| `JOSH_WATCHER_GUARD`        | No       | on      | [`josh run:watcher:guard`](./josh-commands-run.md#josh-runwatcherguard) — a run whose progress watcher stopped.        |
| `JOSH_PARENT_CUT_GUARD`     | No       | on      | A `backlogrun` parent over its session budget.                                                                         |
| `JOSH_POLL_GUARD`           | No       | on      | A `backlogrun` parent or wake session repeating a state read with nothing decided in between.                          |
| `JOSH_SCOPED_GREEN`         | No       | on      | `josh gate` refusing a tree its scoped checks were never green on ([`josh gate`](./josh-commands.md#josh-gate)).       |

### Rule evaluation

| Variable                | Required | Default  | Used when                                                                                     |
| ----------------------- | -------- | -------- | --------------------------------------------------------------------------------------------- |
| `JOSH_EVAL_MODEL`       | No       | `sonnet` | The model `josh eval` runs against ([`josh eval`](./josh-commands-run.md#josh-eval)).         |
| `JOSH_EVAL_CONCURRENCY` | No       | `5`      | How many `josh eval` sessions run at once; a value that is not a positive integer is refused. |

## Variables kit sets itself

kit sets these for the processes it starts, or writes them into a lane's own `.env`. They are listed so every variable the code reads is named here; do not set them by hand. The unit suite sets every `JOSH_SHIP_*` variable it inherits, `JOSH_LANE_CHILD` and `JOSH_LANE_OVERRUN` to an empty value, which their `=== '1'` and issue-number readers take as unset.

| Variable                    | Set by                         | Meaning                                                                                                                                 |
| --------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `JOSH_LANE_CHILD`           | a `backlogrun` dispatch        | This session is a dispatched lane child.                                                                                                |
| `JOSH_LANE_OVERRUN`         | a merged lane's overrun launch | This session investigates a merged lane's overrun; `josh issue:file` records its filings as the investigation's.                        |
| `JOSH_LANE_SEAT`            | `josh lane:open` / dispatch    | The last assigned seat (`1`–`9`), added to the port offset; reacquired before each start or re-dispatch.                                |
| `JOSH_LANE_OUTPUT`          | `josh lane:open`               | Where the lane's child writes its output.                                                                                               |
| `JOSH_LANE_AGENT_PROVIDER`  | a `backlogrun` dispatch        | The provider the lane's child was launched with.                                                                                        |
| `JOSH_LANE_AGENT_ROLE`      | a `backlogrun` dispatch        | The role the lane's child was launched as.                                                                                              |
| `JOSH_LANE_AGENT_MODEL`     | a `backlogrun` dispatch        | The model the lane's child was launched with.                                                                                           |
| `JOSH_LANE_AGENT_EFFORT`    | a `backlogrun` dispatch        | The effort the lane's child was launched with.                                                                                          |
| `JOSH_AGENT_HEADLESS`       | every kit agent launch         | This agent session was launched by kit, so no person reads its reply.                                                                   |
| `JOSH_AGENT_ROLE`           | every kit agent launch         | The role this agent session was launched in; a reviewer takes no cut.                                                                   |
| `JOSH_HOOK_CWD`             | every kit hook command         | The directory the hook was launched in; a hook resolves a call's relative path against it.                                              |
| `JOSH_RUN_HEADLESS`         | the run supervisor             | This session was launched headless by the supervisor.                                                                                   |
| `JOSH_SHIP_SUPERVISED`      | `josh ship --detach`           | This `josh ship` runs under the detached supervisor.                                                                                    |
| `JOSH_SHIP_LAUNCH_ID`       | `josh ship --detach`           | The supervisor launch this `josh ship` belongs to.                                                                                      |
| `JOSH_SHIP_FOLLOWUP`        | `josh ship`                    | This `josh followup` is the one a `josh ship` runs, so it prints no section of its own.                                                 |
| `JOSH_SHIP_RETRY_PENDING`   | `josh ship`                    | `josh ship` will run this stage again on an infrastructure stop, so the AI review gate sends no confirmation for an unreadable listing. |
| `JOSH_INIT_HANDED_OFF`      | `josh init`                    | `josh init` already handed off to the project's installed kit once.                                                                     |
| `JOSH_WORKFLOW`             | `josh start`                   | `github`: the setup `josh start` runs records `josh.workflow`, so a `basic` project receives `.claude/settings.json`.                   |
| `JOSH_UNIT_RUN_MARKED`      | `josh gate`                    | The gate already claimed its place for the unit suite it spawns.                                                                        |
| `JOSH_UNIT_GUARD_LOG`       | the unit suite's network guard | Where the guard logs blocked calls.                                                                                                     |
| `JOSH_PROJECT_TEST_SCRIPT`  | `josh test:unit`               | A `basic` project's own `test` script is running, so a call back into the unit check from inside it skips instead of starting it again. |
| `JOSH_GIT_BINARY`           | the unit suite's network guard | The `git` every spawn runs in place of the platform's own binary.                                                                       |
| `JOSH_TEST_READS_DIRECTORY` | a whole-suite `josh test:unit` | Where each worker's read recorder writes the repository paths its test files read, merged into the test-read map after a green run.     |
| `JOSH_TEST_READS_ROOT`      | a whole-suite `josh test:unit` | The repository root the read recorder resolves read paths against; a path outside it is not recorded.                                   |
| `JOSH_UNIT_COUNT_FILE`      | `josh test:related`            | Where the unit suite's reporter writes how many test files the run ran, recorded with the run's scope in the lane ledger.               |
