# josh automation command reference — rationale and history

History behind [josh-commands-automation.md](../josh-commands-automation.md), kept here so the
reference states only each command's contract — what it does, its arguments, output, exit codes and side effects.
The run, lane and session commands' history is in [josh-commands-run-rationale.md](josh-commands-run-rationale.md);
the issue, epic, backlog and review commands' history is in
[josh-commands-backlog-rationale.md](josh-commands-backlog-rationale.md).

## The batching guard is off in a lane child

A _refusal_ ends a headless child's turn (joshuafolkken/kit#2138), so a lane child was given a
notice instead. joshuafolkken/kit#2178 took joshuafolkken/kit#2164's notice `off`;
joshuafolkken/kit#2276 restored it, naming concrete recent calls and recurring every single-call turn.
joshuafolkken/kit#2405's re-measurement read **1.13** calls per round trip (`josh time:density`, ten
most recent lanes) — below the 1.40 target and under the pre-restore baseline — so the notice was cut
off for good: a `PreToolUse` hook cannot see the turn it is in, so a notice is structurally unable to
reach the turn it would pack.

A chain of single-call searches is the exception: its own `search-batching` row refuses it in a lane
child, because search chains were the largest share of the child's single-call pairs
(joshuafolkken/kit#5342). It re-fires every third such turn and stands aside where the investigation
guard refuses the same call.

In the main line the guard once fired once per run and fell silent for the rest of a run that ignored
it; it now re-fires, the notice on a tighter interval than the refusal (joshuafolkken/kit#2276).

## The investigation guard refuses in a lane child

It was `off` from joshuafolkken/kit#2138 to joshuafolkken/kit#2382, on the reason that a child cannot
dispatch a sub-unit to read its own edit targets. joshuafolkken/kit#2382 re-measured six lane
children each reading 4–17 unedited files, so the reading was there to send out, and the guard became
a notice naming those files. joshuafolkken/kit#3927 measured the notice not moving the reading — 52%
of lane cost stayed in main-line exploration — so the child is refused at the unchanged threshold. A
hook denial returns to the model as guidance, and the refusal fires once per accumulation.

## Where each command came from

The issues that introduced or reshaped each command, kept here so the reference carries no
provenance citations. Read an issue for the decision behind a behavior; the reference states only
the behavior.

| Command                   | Issues                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `josh time:density`       | #2405                                                                                                      |
| `josh pretool:guard`      | #2138, #2164, #2178, #2276, #2297, #2298, #2382, #2385, #2405, #2807, #2984 (the hook launch shape), #3927 |
| `josh stop:guard`         | #2121, #2247, #2422                                                                                        |
| `josh followup`           | #2446, #2770, #3023                                                                                        |
| `josh observations:flush` | #2763, #2919                                                                                               |
| `josh measure:rerun`      | #2178, #3064                                                                                               |
| `josh review:record`      | #2325, #2343, #2419, #2919, #3645                                                                          |
| `josh reserved-run`       | #2351                                                                                                      |
| `josh repo:party`         | #2122                                                                                                      |

## `josh refactor:scan` in detail

Compute the refactoring candidates `prompts/refactoring.md` §4.1–§4.3 describes, run as a command: it picks the target files (branch diff plus untracked, or `scripts/`; excluding `demo`, `src/routes/stories`, `/* @refactor-ignore */`), expands the scope along the import graph, asks the project's own eslint for the §4.2 categories, and answers `verdict: clear` / `verdict: candidates`. Reports and never fails.

## `josh format:edited` in detail

- **Reports the problems `eslint --fix` could not fix** on the same `additionalContext`, lifted from the `--fix` pass's own stdout (no extra process) — file, `line:col` and rule name, so they are seen on the edit rather than deferred to the gate. What eslint fixed is applied silently; a file that runs prettier alone (`.md` / `.yml`) reports nothing. The block is cut to a bounded length and marked when a lint dump would be large. It never sets `permissionDecision`, so the edit is not turned into a failure.

## The batching guard and the hook launch in detail

The batching guard refuses a tool call that would make a third consecutive single-call turn, pushing the run toward batching independent calls. It is one of the `PreToolUse` guards consolidated into `josh pretool:guard` (with the investigation and rule guards), so `.claude/settings.json` names the union of their matchers and runs the one process, fed the pending call as JSON on stdin.

- The launcher (`scripts/hooks/run-hook.sh <name> [arguments]`) holds everything the hooks share, once: it hands the hook to the ready gate, which runs `dist/hooks/<name>.js` once it passes and otherwise runs the live source through `pnpm josh <command>` — the name with its first `-` turned into `:` (`pretool-guard` → `pretool:guard`).
- The root prefix in front of it (`scripts/init/hook-launch.ts`) takes the root Claude Code names in `CLAUDE_PROJECT_DIR`, so a Claude Code hook call starts no `git` and no `env` or `dirname` process (joshuafolkken/kit#3946, joshuafolkken/kit#4187): a hook runs on every tool call across every lane, and on macOS each process start is also scanned by `XprotectService` / `syspolicyd`.
- Codex names no root and runs a hook in the session's directory, so there the prefix asks git once.
- Inside one of Claude Code's own worktrees (`EnterWorktree`, an `isolation: "worktree"` subagent) `CLAUDE_PROJECT_DIR` still names the main checkout while the hook is launched from the worktree (measured, joshuafolkken/kit#4617). The prefix exports the launch directory as `JOSH_HOOK_CWD`; the launcher takes its code from the main checkout — a fresh worktree has no install and no bundles — and moves the working directory into `.claude/worktrees/<name>`, by parameter expansion alone, so no `git` starts.
- The launcher clears the git location variables with the shell's own `unset`, and only when one is set and git still resolves without them, so the ordinary call pays nothing for it. The prefix stays one short line in every `settings.json` and `hooks.json`.
- The ready gate (`tools/hooks/hook-bundle-ready.ts`, run by plain `node`) compares a content digest of the bundle inputs recorded at build time (`dist/hooks/inputs.json`) with the source on disk. Fresh → the bundle runs in the gate's own process, so a hook call starts node once. Stale → it rebuilds `dist/hooks/` in-process (a fraction of a second) and says so on stderr, so an edited guard is never shadowed by its old bundle. A checkout that cannot build drops to the `pnpm josh` fallback with a stderr warning — that path is slow and a hook exceeding its timeout lets the call through unguarded.
- Silent in a dispatched lane child (`JOSH_LANE_CHILD`): a _refusal_ ends a headless child's turn, and a `PreToolUse` hook cannot see the turn it is in, so the notice is `off`; the lever that moves the density is a composite command (`read:files` / `edit:files`). Decided in `scripts/lane/lane-guard-policy.ts` — `refuse` / `notice` / `off`; a chain of single-call searches is still refused there (`search-batching`). Why: "The batching guard is off in a lane child" above.
- Fires more than once per run (main line). The first firing lands when a run of single-call turns reaches the limit; if the run keeps single-calling it fires again — the refusal every `REFIRE_EVERY` further turns (the initial limit), the notice every `NOTICE_REFIRE_EVERY` (tighter, since a notice cannot wedge a run). Both are single constants in `time-batch-guard.ts`. A call re-issued unchanged after a firing is let through, and a batched turn starts a fresh sequence.

## `josh time:density` in detail

Report tool calls per round trip across the recent lane sessions — the density the batching guard is measured on, as a command rather than a hand-counted `node -e`. Kit-only (it reads kit's own lane transcripts). Aggregates the ten most recent lane sessions holding at least thirty round trips, dividing summed calls by summed round trips through the same `time-round-trips.ts` the guard and the live density line read, so the three cannot disagree about what a round trip is.

**`independent` / `dependent` reuse `time_bundles`' walk** (joshuafolkken/kit#4622): an independent turn could have gone out beside the single-call turn before it, a dependent one shared a target with the open sequence. A dependency held only in the earlier call's output is invisible to the target test, so `independent` over-reports — mostly in the `Bash: grep` / `sed` / `cat` kinds. `independent by kind` sums the per-tool rows across the lanes and prints the top five. Run from a lane, the command resolves to the main checkout, whose lane root holds every lane's transcript.

## The investigation guard in detail

- **A refusal in a dispatched lane child too** (`JOSH_LANE_CHILD`), at the same threshold. Why: "The investigation guard refuses in a lane child" above. Decided from the one-place enumeration in `scripts/lane/lane-guard-policy.ts`.

## The rule guard in detail

- **The implementation-phase cut row**: the trigger is an `Edit` / `Write` from a lane working tree that has not yet taken its cut, once the recent-context verdict (`pnpm josh cost --cut`'s, unmeasurable read `!== UNDER` on the safety-net side) is over the shared threshold, handing over `pnpm josh run:cut --impl <N> --handoff <path>`. Unlike the pre-gate row it fires on every threshold crossing: once per run left a `busy` / `failed` verdict to grow the context unwatched, so it carries `decide` and lets an edit reissued right after a refusal through. The verdict read is reused over a few-second per-checkout window. `.claude/skills/workflow-commands/pre-gate-cut.md` is the single source.

Set `JOSH_RULE_GUARD` to `off` / `0` / `false` / `no` to disable. Some rows deliver once per run; some — force push / branch delete, direct filing, the bare-`git` and run-tail push rows, and the implementation-phase cut — fire on every occurrence; and a row that asks for an earlier command (the Issue comments, `pkg:scout`, the rule-body placement questions) refuses every call until that command is on the transcript.

## `josh pretool:guard` in detail

**How each guard row behaves in a dispatched lane child is an enumeration, not a judgement**. A denial is guidance to an interactive main line but a fatal turn-ender to a headless `claude -p` child, so `scripts/lane/lane-guard-policy.ts` lists, in one place, each guard's three-valued mode for a lane child (`JOSH_LANE_CHILD`) — `refuse`, `notice`, or `off`: `investigation` is `refuse` (its notice was measured not to move the reading), `batching` is `off` (a notice is structurally unable to reach the turn it would pack) save its `search-batching` row, which refuses a chain of single-call searches, `duplicate-read` is `notice` (a refusal would kill the child, and the unchanged re-reads it catches are measured in those very children — so it nudges rather than silences), while `rule` stays `refuse` — it carries the lane-only rules a child depends on (`pre-gate-cut`, `lane-park`) and the safety rules it must still obey. `lane-guard-policy.test.ts` pins that the enumeration and the guards' live behavior cannot disagree.

## `josh stop:guard` in detail

The `Stop` hook: one process delivering the stop-time rules. Stop-notification and hold-release have a fixed answer, so the hook runs it itself and shows what it did as a `systemMessage`, blocking only when that fails (joshuafolkken/kit#3919); filing-offer, the session language and the lane / headless waits **block** the stop, since `{"decision":"block"}` is a `Stop` hook's one channel to the model. In an unattended run (a headless session kit launched, a lane child, or the `backlogrun` parent), a reply whose prose offers to file an Issue ("起票してよければ", "Shall I file …") on a turn whose transcript tail holds no filing that a guard let through is sent back to file it with `pnpm josh issue:file`, because a first-party filing is Tier A (`observation-filing.md`); it stays silent when the reply names a third-party `owner/repo` or the session owner cannot be read, since a Tier C filing is never prompted, and in an interactive session, where asking before filing is correct. A bare `#N` in the reply is left alone: the hook neither prints citation lines for it nor sends the reply back (joshuafolkken/kit#4626). Built on `hook-decision.ts`, `lane-park.ts`, `turn-filings.ts`, `repo-party.ts` and `run:hold`; fails open, and `stop_hook_active` breaks a block loop. The rows are in `prompts/collaboration-workflow/rule-delivery.md`.

## `josh fresh:run` in detail

**Output / exit codes:** the image build, the pack and the container's session are printed and written to `<log-dir>/<scenario>-<n>.log`, whose path is the last line. Exit status is the container's — `0` when every command of the scenario passed, whatever the probes after them exited with — the build's when the image could not be built, and `1` for an unknown pattern, a named pattern run outside a kit checkout, an invalid spec, a missing Docker, a GitHub scenario when `gh auth token` prints no token, or a `requires_claude` scenario with no Claude token (see `josh auth:setup`).

## `josh sonar:new-code` in detail

Fail when a pull request adds any new SonarCloud issue — of any type or severity — or any new duplicated block. It reads the pull request's unresolved issues (`api/issues/search`) and its `new_duplicated_blocks` measure, prints one line per issue and then the verdict: `clean` (exit `0`), `findings: …` or `unreadable: …` (exit `1`) — a failed read fails too, so an outage never passes a pull request as clean. An issue resolved in SonarCloud as accepted or a false positive is not counted. `SONAR_TOKEN` is sent when set. The distributed `sonar-qube.yml` runs it after the scan on every pull request; full handling: `prompts/sonar-hotspot-handling.md`.

## `josh followup` in detail

**Behavior:** merging is the default. The CI wait polls every 10 s with a 32-minute budget (`JOSH_CI_TIMEOUT_SECONDS` overrides); any non-success conclusion ends it immediately naming the failure, and a merge conflict (`DIRTY`) ends it on the first poll. CodeRabbit is exempt from the wait, and a skipped check is noted in the completion Telegram. On a merged run only, it closes any completed epic (now cascading up nested epics, so a completed parent closes too), confirms the Issue closed — closing it with a comment when GitHub did not apply `closes #N` — removes `in-progress`, flushes the observation ledger, ends the progress watcher, and lists up to five next-run candidate issues. Give the tool call its longest timeout — the wait can outlast a single call and `&` backgrounding does not survive. Every CI poll and the step right before the merge also check the run's issue: a person's update the run has not acknowledged stops it unmerged, printing the update ([`josh issue:ack`](../josh-commands-backlog.md#josh-issueack)); the blocking `gh pr checks --watch` phase before the polls is not interrupted.

**Stage timing:** one `followup stage: <name> <seconds>` row per stage, then `followup stages total:`.

- A failed run prints it up to the stage that threw, named `interrupted`; the `telegram-and-merge`
  row appears only on a run that merged, and a run that merged nothing prints `telegram` instead.
- A row named `<a>-and-<b>` is a batch of requests sent together; `checks-wait` is never overlapped.
- The total is the sum of the stages, not the wall clock — the post-merge tail sits outside it.
- The completion tail's two reads (the next-issue list and the unreleased-merge count) go out
  together and print one `completion` row after the total, above the completion lines; it is not in
  the total.

**AI-reviewer scan:** top-level PR comments from AI reviewers are scanned independently of CI status.

- Blockers are structural, not NLP: a Claude Review body with `### Issues`, `### Problem`,
  `#### Logic bug` or a numbered `### 1. …` heading; a CodeRabbit `Actionable comments posted: N` with
  N > 0. Rate-limit notices and sign-offs (`All issues resolved ✓`) match nothing.
- A standing blocker without `--ai-review-ignore-reason` sends a `confirmation` Telegram and exits
  non-zero; with it, the reason is posted and the run proceeds. A comment listing that could not be
  read is a standing blocker.
- CodeRabbit is temporarily non-blocking end to end — out of the default required checks (restore via
  `JOSH_REQUIRED_CHECKS`); its findings are audit notes.

**Config claims:** every changed path is matched against what `josh sync` distributes
(`AI_COPY_FILES`, `AI_COPY_FILE_MAPPINGS`, `AI_COPY_DIRECTORIES`, `SYNCED_PATHS`), and the claimed
paths are reported in the notification and the Issue report. It stops nothing; `josh sync:scope`
gives the same answer.

## `josh notify` in detail

**Output / exit codes:** a send that reached nobody exits non-zero, naming the missing variables or the HTTP status (never the token values). `planning` / `completion` skip with exit 0 unless [`JOSH_NOTIFY_OPT_IN`](../environment-variables.md#notification-behavior) names them. `.env` is read via `--env-file-if-exists`. Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, or `JOSH_NOTIFY=off` to skip.

## `josh observations:flush` in detail

Commit the observation ledger lines no run's own commit carried (`.josh/observations/`) as a pull request of its own (no `closes #N`), wait for the required checks, merge it, and return to the default branch. A run needs none — a lane's included: `josh git` stages the run's own `<N>.md` with its commit when its grammar holds, and `pnpm josh followup` commits a line appended after that onto the pull request before it merges. What is left here is a line written on the default branch outside any issue's run, in a date-named `<YYYY-MM-DD>.md` — and the closed issues' comment rounds a lane child did not carry (joshuafolkken/kit#5326), copied into `<N>-comment-rounds.md` once the default branch is fast-forwarded, in the same pull request.

**Behavior:** refuses off the default branch (naming `pnpm josh main:sync`) and refuses when the working tree holds any change besides the ledger (listing those paths). When the ledger matches the commit it sits on it prints `clean` and exits 0. A commit the pre-commit hook rejects is rolled back and its branch removed; a leftover flush branch that holds a commit is landed first, one holding none is discarded. A single run's `pnpm josh run:tail` runs it after the merge, so it is rarely typed by hand. It acts on the checkout it runs in: a lane's lines merge with the lane's own pull request, so a lane is refused like any feature branch, and nothing flushes at `pnpm josh run:carry --end` any more.

## `josh measure:rerun` in detail

**Behavior:** when a value has not moved, the premise the rule rested on is recorded as refuted — one line appended to the observation ledger (`.josh/observations/`, in the file for the issue the checked-out branch leads with, or a date-named file outside any issue's branch), keyed to the command so a second refutation of the same measurement is a same-key repeat the promotion rule counts. It reuses that append-only ledger rather than a second one. A section written in prose (no `` `command` → value `` line) is refused, since a natural-language measurement cannot be re-run. `pnpm josh observations:flush` is the ledger's commit path.

## `josh review:record` in detail

Record a `/code-review` round's findings so they survive the run. It appends one `- rf:<category> | <severity> | <file> | <date> | #<issue>` line per finding to the issue's own file of the observation ledger (`.josh/observations/<N>.md`, in the work tree the command runs in — a lane's inside a lane), under a distinct `- rf:` prefix the observation lines' `- k:` grammar never reads. It is the one write path for findings.

**Behavior:** each positional is `<category>:<severity>:<file>`, split on its first two colons so a `:line` citation stays in the file field. A positional may end with ` — <reason>` (joshuafolkken/kit#4817): the ledger keeps the spec alone, and the finding's location and the reason's first sentence also go to the durable stop log (`review-stops.jsonl`), marked fixed, which `review-prior-findings.ts` carries into the lane's next review prompt and next stop's fix. A category outside the nine review-rubric ones or a severity other than `high` / `medium` / `low` is refused with the usage and the accepted values. A call with no findings writes a single `- rf:none | none | - | <date> | #<issue>` line, so a clean round differs from an unreviewed one. `--comment` posts the same lines as a comment on the issue and appends nothing — for a round after the pull request opened, where a line in the tree would be pushed onto it and restart its CI. Once the issue closes, the next ledger round outside a lane carries those lines into `.josh/observations/<N>-comment-rounds.md` on its own commit — a lane child leaves them to `josh observations:flush`, since parallel lanes wrote the same file and waited and conflicted on it (joshuafolkken/kit#5326) — for `josh review:findings` and the retrospective, from `OWNER` / `MEMBER` / `COLLABORATOR` comments only; a carry that cannot read GitHub only warns. Both the append and `--check` use the running work tree's ledger — a lane's inside a lane. `pnpm josh observations:flush` commits them like any ledger change.

A recorded code round also says whether `josh ship` reuses it as its round 1 (joshuafolkken/kit#4763), from the ship's own predicate (`scripts/review/review-round-reuse.ts`):

- `Reused`: the files this round covers hold still since the record.
- `Reused, delta to round 2`: every file moved since the record is one round 2 reads from the round-1 brief's stamp after the commit (joshuafolkken/kit#4878), or the ship's own round 1 stopped on a finding. The ship does not run round 1 again. A file a recorded High cites always reads as moved, and its fix is such a move where round 2's delta holds it: the round-2 brief names it as the High's fix, to read whole (joshuafolkken/kit#4941).
- `Not reused`: a move round 2 would not read (documentation or a prompt, a file back at its briefed bytes, a file outside the change, a file a recorded High cites whose fix has not landed), a default-branch change to a covered file round 2 would execute, the round was not attested on this branch, or the issue changed after its brief — run `pnpm josh run:review` and the round-1 `/code-review` in the session. The line names the condition that hit and, where one did, the path that met it.

The answer is for this tree: where the ship's sync brings in a covered file, it reviews round 1 again (joshuafolkken/kit#4983). A merge that moves only the base keeps the round as it stands (joshuafolkken/kit#4829) — every recorded digest matches and no path the default branch changed is a recorded file round 2 would execute; a recorded base git can no longer resolve reads as `Not reused`.

A covered document, prompt or inert path only the default branch moved is no move: the round's recorded blob, carried onto the new base, reproduces the file now. One the lane edited since the record, a carry git cannot make, or one a recorded High cites still reads as a default-branch change (joshuafolkken/kit#4984).

A reuse question git cannot answer reads as `Not reused`; an issue that cannot be read reads as fresh, as in the ship, and `josh followup` still refuses a stale review. The exit code does not change.

## `josh release` in detail

Release everything main has taken since the version last changed — one command, run by a person. It counts merges on `origin/<default>`'s first-parent line since the last version change, raises the version by that many minors, opens and merges a `release/v<version>` pull request, then polls for the `v<version>` tag, the npm publish and the GitHub Release. Each stage reached prints one line, with a link where there is one; the completion line prints only when every stage is reached:

**Runs in its own work tree, never the root checkout.** The count is read from `origin/<default>`, and the version bump, commit and push happen in a dedicated linked work tree cut from `origin/<default>` as the `release/v<version>` branch (placed under the same `.<repo>-lanes/` sibling directory the lanes use, named `release` so it collides with no lane). The tree is removed whether the run succeeds or fails, and its local release branch with it. Because the root is never touched, a release can run beside a [`backlogrun`](../how-to/run-issues.md) and can start even when the root is dirty or sitting on another branch. The commit goes through lefthook's pre-commit, so the work tree gets its own dependency install (the hook is never disabled to skip it).

## `josh release:github` in detail

Create the GitHub Release for a tag `josh release` cut, with notes generated from `.github/release.yml`. Run by CI, not by a person: kit's own `publish.yml` runs it in its `create-release` job, and every consumer receives `.github/workflows/github-release.yml` from `josh init` / `josh sync`, which runs it when `auto-tag.yml` announces the tag (`new-tag-created`) and, in a repository with a `publish.yml`, waits there for the consumer's `Publish <tag>` run to succeed before releasing (a `workflow_run` on `Publish` never fires for a run the `GITHUB_TOKEN` started).

Releases are created in version order: a later tag waits for the nearest lower tag above the floor to get its release, and skips it when that tag's publication failed, or when its `Publish <tag>` run has completed without a release and no run in `RELEASE_RUN_WORKFLOW` is still at work on it — such a tag never gains a release. A run there is at work on the tag while it is unfinished and titled `GitHub Release <tag>`, or titled without a tag (started before the title named one). A tag that already has a release is left alone. The consumer's release workflow needs the `.github/release.yml` categories and a `Publish` workflow titled `Publish <tag>` (`run-name`) when it has one.

## `josh latest:scope` in detail

Prints `required` or `skip` on stdout (reason on stderr) — whether this checkout must update. Read the answer with `$(pnpm josh latest:scope)`; workflow commands ask it instead of updating unconditionally. No completion record answers `required` (fresh checkout, cleared temp dir, or a half-finished chain — a failed pnpm bump included, since `latest:corepack` runs right before the record and exits non-zero). The freshness window is **12 hours**, overridable via `JOSH_LATEST_MAX_AGE_HOURS`. The record is per-checkout, and `--record` is the write half used by the chain (prints nothing on stdout).

## `josh pre-push-unit` in detail

Runs the unit suite for the pre-push hook, reusing the result when [`josh gate`](../josh-commands.md#josh-gate) already recorded that exact tree green. Wired in by `lefthook/base.yml` as the pre-push `test-unit` command. Reuse requires the gate's file map, base commit and non-empty record to match, plus an empty `git status --porcelain` so the pushed HEAD equals the verified tree; otherwise the whole suite runs. A project with no vitest prints a skip notice; one with vitest but no test file fails.

## `josh reserved-run` in detail

Runs a command while holding a place in the machine-wide core budget ([`josh gate`](../josh-commands.md#josh-gate)'s ledger, `scripts/gate/core-budget.ts`). Wired in by `lefthook/base.yml` as the pre-push `setup` install and the `audit` command, so both count toward the same budget the gate's checks reserve from — eight lanes pushing around the same time no longer spike a machine the gate thought it had to itself. It reserves memory too (joshuafolkken/kit#4582): a lane ran `reserved-run 4 -- sh -c '… eslint . --concurrency 4 …'`, typed eslint holds about 2.4 GB per worker, and a 12 GB process admitted beside four lanes swapped the machine. The estimate is the largest tool on the line, not the sum, because commands on one line run one after another. A command the table does not know stays at 0 MB, so a josh command that reserves its own (`pnpm josh audit`) is not counted twice. eslint's `--concurrency auto` is read as half the cores, ESLint 10's own cap. A lane child is refused a multi-worker eslint even when reserved: one lane's 12 GB starves every other lane whatever the ledger says, so a concurrency is measured outside a lane.

## `josh pre-commit-type-check` in detail

Type-checks the whole project for the pre-commit hook, reusing the result when [`josh gate`](../josh-commands.md#josh-gate) already recorded that exact tree green. Wired in by `lefthook/base.yml` as the pre-commit `type-check` command; runs `pnpm exec tsc --noEmit` when it runs. Reuse requires the gate's file map, base commit and non-empty record to match, that every `git status --porcelain` entry be fully staged (so the committed index equals the verified tree), and that the gate's type-check step be `tsc --noEmit` (projects using a `josh-app` / `josh-game` `check:ci` shim always run the full check). Nothing is forwarded to `tsc`; an argument other than `--force` is refused.
