# josh CLI — Command Catalog

Auto-generated — do not edit.
Run `tsx scripts/document/generate-catalog.ts` to regenerate.

## Development

### `josh batch:guard`

> **Audience:** automation · **Side effects:** none

_No arguments._

Claude Code hook: refuse a third consecutive single-call turn (reads the tool call on stdin)

---

### `josh behavior` · `josh bh`

> **Audience:** developer · **Side effects:** files

_No arguments._

Check the current run's recorded transcript against the behavior assertions (no model call)

---

### `josh bytes` · `josh by`

> **Audience:** developer · **Side effects:** none

`<files...>`

Print an agent-read document's byte size against its ceiling and the headroom left

---

### `josh check` · `josh c`

> **Audience:** developer · **Side effects:** processes

`[arguments...]`

Type-check with tsc (skips a basic project with no TypeScript to check)

---

### `josh codex:hook-adapter`

> **Audience:** automation · **Side effects:** none

`<pretool|posttool>`

Codex hook: run the pretool or posttool guard on a Codex payload (reads the tool call on stdin)

---

### `josh cspell:dot` · `josh sd`

> **Audience:** developer · **Side effects:** processes

_No arguments._

Run spell check including dotfiles

---

### `josh e2e:retry-check`

> **Audience:** automation · **Side effects:** none

_No arguments._

Report whether the preview server crashed during a failed E2E attempt (CI)

---

### `josh exports:unused` · `josh eu`

> **Audience:** developer · **Side effects:** none

_No arguments._

Report exported namespace members nothing reads (kit only; a consumer project skips it)

---

### `josh format` · `josh f`

> **Audience:** developer · **Side effects:** files, processes

_No arguments._

Format code with prettier and eslint (skips a tool a basic project lacks)

---

### `josh format:edited`

> **Audience:** automation · **Side effects:** files, processes

_No arguments._

Claude Code hook: format the file just edited (reads the tool call on stdin)

---

### `josh gate` · `josh ga`

> **Audience:** developer · **Side effects:** files, processes

`[--verbose|--force|--no-unit]`

Run lint, type check, spell check and unit tests concurrently

---

### `josh lines` · `josh ln`

> **Audience:** developer · **Side effects:** none

`<files...>`

Print a file's code lines against the max-lines limit and the headroom left

---

### `josh lint` · `josh l`

> **Audience:** developer · **Side effects:** processes

_No arguments._

Check code with prettier and eslint (skips a tool a basic project lacks)

---

### `josh lint:related` · `josh lr`

> **Audience:** developer · **Side effects:** processes

`[files...]`

Check only the changed files with prettier and eslint (whole tree on fallback)

---

### `josh metrics` · `josh mt`

> **Audience:** developer · **Side effects:** files · **kit only**

`[--no-startup | --totals-only | --accept --reason "<why>"]`

Print repository-wide quality totals and durations, and fail when one grew past its baseline

---

### `josh port` · `josh pt`

> **Audience:** developer · **Side effects:** none

`<dev|preview>`

Print the PORT_SEED-resolved dev or preview port

---

### `josh pr:classification`

> **Audience:** automation · **Side effects:** none

_No arguments._

Require one release classification on a pull request

---

### `josh pretool:guard`

> **Audience:** automation · **Side effects:** none

_No arguments._

Claude Code hook: the batch, investigation and rule guards in one process (reads the tool call on stdin)

---

### `josh refactor:scan`

> **Audience:** automation · **Side effects:** processes

_No arguments._

List refactoring candidates in the changed scope by category and answer clear/candidates

---

### `josh session:lang`

> **Audience:** automation · **Side effects:** none

_No arguments._

Claude Code hook: print a non-default JOSH_SESSION_LANG for the session context, and the run:board reply rule while a backlogrun is live (otherwise nothing)

---

### `josh stop:guard`

> **Audience:** automation · **Side effects:** none

_No arguments._

Claude Code Stop hook: deliver the three stop-time rules — hold notify/release and issue citation (reads the Stop payload on stdin)

---

### `josh test` · `josh t`

> **Audience:** developer · **Side effects:** processes

_No arguments._

Run unit and E2E tests

---

### `josh test:declared` · `josh td`

> **Audience:** developer · **Side effects:** processes

`[--match]`

Report whether the working-tree change needs a test (required/exempt/satisfied); --match checks Step 0 declarations on stdin

---

### `josh test:e2e` · `josh te`

> **Audience:** developer · **Side effects:** processes

`[filters...]`

Run E2E tests with Playwright (skips when absent or no e2e files)

---

### `josh test:red` · `josh trd`

> **Audience:** developer · **Side effects:** git, processes

_No arguments._

Run the changed unit tests against the pre-fix tree (merge-base worktree) and report red/green/no-test/test-only

---

### `josh test:related` · `josh tr`

> **Audience:** developer · **Side effects:** processes

`[files...]`

Run only the unit tests related to the changed files (full suite on fallback)

---

### `josh test:unit` · `josh tu`

> **Audience:** developer · **Side effects:** processes

`[filters...]`

Run unit tests with Vitest (skips when Vitest is absent; fails when it has no tests)

## Project

### `josh adopt` · `josh ad`

> **Audience:** developer · **Side effects:** files, git, network, processes

`[--dry-run]`

Upgrade every installed @joshuafolkken toolkit here and open the pull request

---

### `josh dogfood:commit`

> **Audience:** automation · **Side effects:** files, git · **kit only**

`<dir>`

Make the first commit of a dogfood run's own kit-test-* project

---

### `josh init` · `josh i`

> **Audience:** developer · **Side effects:** files, network, processes

`[--profile basic|full] [--no-install]`

Initialize config in a new project

---

### `josh profile` · `josh pf`

> **Audience:** developer · **Side effects:** files

`[--profile basic|full]`

Show the project profile and the reason for it

---

### `josh propagate` · `josh pg`

> **Audience:** maintainer · **Side effects:** files, network

`[--dry-run] [--skip-publish-wait] [--target <repo>]`

Carry the published release into every consumer repository next to this one

---

### `josh registry:migrate` · `josh rmi`

> **Audience:** developer · **Side effects:** files, network, processes

_No arguments._

Migrate a project from GitHub Packages to public npm

---

### `josh sonar:hotspots`

> **Audience:** automation · **Side effects:** network

`<PR>`

Fetch SonarCloud hotspots on a pull request and print each one's Step B disposition

---

### `josh sonar:new-code`

> **Audience:** automation · **Side effects:** network

`<PR>`

Fail when a pull request adds any new SonarCloud issue or duplicated block

---

### `josh start` · `josh st`

> **Audience:** developer · **Side effects:** files, git, network, processes

`[--profile basic|full] [--yes] [--github] [--public] [--init-command <command>]`

Set a project up for the GitHub Issue workflow, from git init to the setup PR

---

### `josh sync` · `josh sy`

> **Audience:** developer · **Side effects:** files

_No arguments._

Sync config files

---

### `josh sync:scope`

> **Audience:** automation · **Side effects:** none

`[--staged] [--json]`

Say whether this change touches a file josh sync distributes

---

### `josh ui:routes`

> **Audience:** automation · **Side effects:** none

`[--staged]`

List the screenshot-target routes the current change touches

## Workflow

### `josh followup`

> **Audience:** automation · **Side effects:** git, network, notifications

`<title> [--notify-message <text>]`

Follow-up git workflow

---

### `josh git` · `josh g`

> **Audience:** developer · **Side effects:** git, network

`[-y] <message>`

Git workflow helper

---

### `josh main:merge` · `josh mm`

> **Audience:** developer · **Side effects:** git, network

_No arguments._

Merge origin default branch into the current branch

---

### `josh main:sync` · `josh ms`

> **Audience:** developer · **Side effects:** git, network

_No arguments._

Checkout default branch, pull latest, and prune merged remote-gone branches (refuses inside a lane)

---

### `josh measure:rerun`

> **Audience:** automation · **Side effects:** network, processes, files

`<issue-number>`

Re-run a merged issue’s baseline command and print the before/after pair

---

### `josh notify`

> **Audience:** automation · **Side effects:** notifications

`[--task-type <type>] [--body <text> | --body-file <path>] [--issue-url <url>] [--pr-url <url>] [--issue-title <text>] [--repo-name <name>]`

Send Telegram notification

---

### `josh observation:record`

> **Audience:** automation · **Side effects:** files

`<key> <depth> <where> <what> [--checkout <path>]`

Record an observation sighting and answer whether it is now filed

---

### `josh observations:flush`

> **Audience:** automation · **Side effects:** git, network

_No arguments._

Commit the observation ledger as a pull request of its own, and merge it

---

### `josh pr` · `josh gp`

> **Audience:** developer · **Side effects:** network

`<message>`

Create PR only (skip commit and push)

---

### `josh review:findings` · `josh rvf`

> **Audience:** developer · **Side effects:** files

_No arguments._

Count review findings by category from the observation ledger

---

### `josh review:record`

> **Audience:** automation · **Side effects:** files, network

`--issue <N> [--comment] [<category>:<severity>:<file> ...] | --check --issue <N>`

Record a review round’s findings, or check a round was recorded

## Versioning

### `josh bump` · `josh bp`

> **Audience:** maintainer · **Side effects:** files

`[major|minor|patch]`

Bump package version

---

### `josh ranges` · `josh r`

> **Audience:** developer · **Side effects:** network

_No arguments._

Check that every published dependency range still resolves for a consumer

---

### `josh release` · `josh re`

> **Audience:** maintainer · **Side effects:** git, network, release

`[--dry-run]`

Release the merges main has taken since the version last changed

---

### `josh release:github`

> **Audience:** automation · **Side effects:** network, release

_No arguments._

Create the GitHub Release for a published tag, with generated notes

---

### `josh release:scope`

> **Audience:** automation · **Side effects:** none

`[--json]`

Say whether a release is owed, from the unreleased merges on main

---

### `josh version` · `josh v`

> **Audience:** developer · **Side effects:** files, network, processes

`[--upgrade]`

Show kit versions; --upgrade updates the global and project install

## Maintenance

### `josh audit` · `josh a`

> **Audience:** developer · **Side effects:** processes

_No arguments._

Run security audit

---

### `josh audit:provision`

> **Audience:** automation · **Side effects:** files, network

_No arguments._

Install the pinned osv-scanner when the audit cannot find one (no-op if present)

---

### `josh doctor` · `josh dr`

> **Audience:** developer · **Side effects:** files

`[--fix]`

Diagnose PATH shadowing of the global josh and show the discovered repository map (--fix reclaims a stale shim)

---

### `josh latest` · `josh u`

> **Audience:** developer · **Side effects:** files, network, processes

_No arguments._

Update dependencies, run security audit, then update pnpm

---

### `josh latest:corepack` · `josh lc`

> **Audience:** developer · **Side effects:** files, network

_No arguments._

Update pnpm on the current major while preserving the integrity pin

---

### `josh latest:guard`

> **Audience:** automation · **Side effects:** files

_No arguments._

Refuse josh latest inside a lane (the update stamp is keyed to the project root)

---

### `josh latest:scope`

> **Audience:** automation · **Side effects:** files

`[--record] [--json]`

Say whether this run has to update dependencies, from when josh latest last finished (--record notes a run)

---

### `josh latest:update` · `josh lu`

> **Audience:** developer · **Side effects:** files, network

_No arguments._

Update all dependencies to latest

---

### `josh overrides` · `josh ov`

> **Audience:** developer · **Side effects:** files

`[--save]`

Check pnpm overrides for drift

---

### `josh reconcile-templates` · `josh rt`

> **Audience:** maintainer · **Side effects:** files

_No arguments._

Record template source hashes (--check to verify drift)

---

### `josh ruleset:check` · `josh rc`

> **Audience:** maintainer · **Side effects:** network

`[--apply]`

Check that the default branch requires every status check kit's workflows report (--apply adds the missing ones)

## Git hooks

### `josh check-commit-message`

> **Audience:** automation · **Side effects:** none

`[<message-file>]`

Git hook: validate commit message

---

### `josh pre-commit-type-check`

> **Audience:** automation · **Side effects:** processes

_No arguments._

Git hook: type-check, reusing a green gate recorded on the committed tree

---

### `josh pre-push-unit`

> **Audience:** automation · **Side effects:** processes

_No arguments._

Git hook: run unit tests, reusing a green gate recorded on the pushed tree

---

### `josh prevent-main-commit`

> **Audience:** automation · **Side effects:** none

_No arguments._

Git hook: block commits to main

---

### `josh reserved-run`

> **Audience:** automation · **Side effects:** processes

`<weight> -- <command...>`

Git hook: run a command while holding a place in the machine-wide core budget

---

### `josh secretlint-scan`

> **Audience:** automation · **Side effects:** none

`[paths...]`

Git hook: scan staged files for secrets

## AI tools

### `josh auto-ok:next`

> **Audience:** automation · **Side effects:** network

`[--exclude <n>[,<n>...]] [--label <name>]`

Print the next opted-in issue an unattended run may pick up outside an epic

---

### `josh backlog:budget`

> **Audience:** automation · **Side effects:** none

`[options]`

Say whether a backlogrun may start more work, keep watching, or finish

---

### `josh backlog:drive`

> **Audience:** automation · **Side effects:** network

`--owner <pid> [options]`

Drive backlogrun through offer, launch and merge; restore this run’s lanes and report when complete

---

### `josh backlog:next`

> **Audience:** automation · **Side effects:** network

`[--exclude <n>[,<n>...]] [--repo <owner/repo>]`

Order the whole opted-in backlog: auto-ok issues and the descendants of auto-ok epics, transitively through nested epics

---

### `josh backlog:offer`

> **Audience:** automation · **Side effects:** files, network, processes

`[options]`

Collapse a backlogrun loop-head event into one call: read backlog:next, ask backlog:budget, return the verdict and any issues to start

---

### `josh backlog:plan`

> **Audience:** automation · **Side effects:** network

`[issue...] [--only] [--waves] [--exclude <n>[,<n>...]]`

Print the whole backlog as a plan: ready now, waiting on what, waiting on a person, out of scope

---

### `josh backlog:stalled`

> **Audience:** automation · **Side effects:** network

_No arguments._

Report whether ready backlog work is sitting undispatched with a free lane and no recent dispatch

---

### `josh backlogrun` · `josh blr`

> **Audience:** developer · **Side effects:** files, network, processes

`[#<n>...] [--only] [--max <n>] [--idle <minutes>] [--agent claude|codex]`

Start a backlogrun in the background and show its board; with one already running, only show the board

---

### `josh cases`

> **Audience:** automation · **Side effects:** files

`<path...>`

Read changed paths and print the I/O boundaries crossed and their mandatory abnormal cases: network | process | fs | none

---

### `josh clone:scan`

> **Audience:** automation · **Side effects:** files

_No arguments._

Count code duplication across files and first-party repositories, printing each clone as file:line pairs

---

### `josh cost`

> **Audience:** automation · **Side effects:** none

`(--cut | --over <tokens-per-request>) [--path <dir>]`

Say whether the next turn of a run crosses the context-cut threshold (--cut) or a given tokens-per-request figure (--over)

---

### `josh defect:rate`

> **Audience:** automation · **Side effects:** network

`[--days <n>]`

Print the defect rate of merged work: defects filed per enhancement completed

---

### `josh delegate`

> **Audience:** automation · **Side effects:** none

`<step> | --list`

Say whether a run step may go to a cheaper execution tier

---

### `josh disposition`

> **Audience:** automation · **Side effects:** none

`<path...>`

Say whether a review finding reaches a runtime path (runtime) or is inert (non-runtime)

---

### `josh doc:read`

> **Audience:** automation · **Side effects:** none

`<file>`

Read a whole document safely: print it, or point at the Read tool when over the Bash cap

---

### `josh doc:section`

> **Audience:** automation · **Side effects:** none

`<file> <heading>`

Print one section of a markdown document, for a `file.md` → "Heading" reference

---

### `josh duplicate-read:guard`

> **Audience:** automation · **Side effects:** none

_No arguments._

Claude Code hook: refuse a second whole-file read of a path whose content has not changed since the run last read it (reads the tool call on stdin)

---

### `josh edit:files`

> **Audience:** automation · **Side effects:** none

`<plan-path | ->`

Apply several content-addressed edits from a plan in one call

---

### `josh epic`

> **Audience:** automation · **Side effects:** network

`<title> <issue...> [--ordered]`

Create an epic issue from its child issue numbers

---

### `josh epic:audit`

> **Audience:** automation · **Side effects:** network

`<epic>`

Audit an epic's children against each other for contradictions

---

### `josh epic:bundle`

> **Audience:** automation · **Side effects:** network

`<issue>`

Say whether a newly filed issue belongs with ones already in the backlog

---

### `josh epic:check`

> **Audience:** automation · **Side effects:** network

`<epic>`

Check an epic issue against the tracking requirements

---

### `josh epic:next`

> **Audience:** automation · **Side effects:** network

`<epic>... [--repo <owner/repo>] [--lanes]`

List an epic's runnable children, bundled per repository

---

### `josh eval` · `josh ev`

> **Audience:** maintainer · **Side effects:** processes, network · **kit only**

`[scenario...]`

Run the agent rule-compliance scenarios (real Claude sessions)

---

### `josh fanout`

> **Audience:** automation · **Side effects:** none

`<unit-files> <unit-files> [<unit-files> …]`

Say whether proposed implementation units are file-disjoint, so they may run in parallel

---

### `josh investigation:guard`

> **Audience:** automation · **Side effects:** none

_No arguments._

Claude Code hook: refuse a read once the unedited-read threshold is reached again (reads the tool call on stdin)

---

### `josh issue:backlinks`

> **Audience:** automation · **Side effects:** network

`<issue>`

Classify an origin issue’s upstream backlinks: ok, missing, or wrong heading

---

### `josh issue:cite`

> **Audience:** automation · **Side effects:** network

`<issue...> [--repo <owner/repo>]`

Print the paste-ready number-link citation line for each issue, in one call

---

### `josh issue:comment`

> **Audience:** automation · **Side effects:** network

`<issue> --body <text> | --body-file <path>`

Post one comment to an issue from a file, so no shell expands the body

---

### `josh issue:file`

> **Audience:** automation · **Side effects:** network

`<title> --body-file <path> --depth <0|1|2> [--route <route>] [--label <name>] [--repo <owner/repo>] [--distinct <N,…>] [--over-cap] [--no-auto-ok] [--requested] [--release]`

File an Issue with every filing step: lint, Origin, fold, WIP cap, duplicate scout, labels, then epic:bundle

---

### `josh issue:fold`

> **Audience:** automation · **Side effects:** none

`<title>... [--not-separable] [--json]`

Before a second filing: say whether findings from this session fold into one issue

---

### `josh issue:fold-existing`

> **Audience:** automation · **Side effects:** none

`<assessment.json> [--json]`

Assess whether a complete draft can join an unstarted issue

---

### `josh issue:lint`

> **Audience:** automation · **Side effects:** files

`<path>`

Check an issue body file for the template's required headings

---

### `josh issue:read`

> **Audience:** automation · **Side effects:** network

`<issue...>`

Print each issue's title, body and every comment on it, in one call

---

### `josh issue:release`

> **Audience:** automation · **Side effects:** network

`<issue>`

Link an Issue to the repository's open release Issue as its blocker, filing one when none is open

---

### `josh issue:scout`

> **Audience:** automation · **Side effects:** network

`<title> [--body <summary> | --body-file <path>]`

Before filing: say whether an issue like this exists and which epic it belongs to

---

### `josh issue:state`

> **Audience:** automation · **Side effects:** network

`<issue...> [--repo <owner/repo>]`

Print each issue's state and labels, in the spelling the documents compare against

---

### `josh lane:await`

> **Audience:** automation · **Side effects:** files, processes

`<issue> [<issue>...] [--owner <pid>]`

Block until any of the named in-flight lane children completes; prints which one finished

---

### `josh lane:close`

> **Audience:** automation · **Side effects:** files, git

`<issue>`

Close a lane, leaving no work tree, branch or directory behind

---

### `josh lane:dispatch`

> **Audience:** automation · **Side effects:** processes

`<issue> <prompt>`

Start a lane’s child as a detached process that outlives this session

---

### `josh lane:launch`

> **Audience:** automation · **Side effects:** files, git, processes

`<issue> [--stash <message>]`

Collapse a backlogrun lane-start event into one call: open the lane, pop and re-install on the first, dispatch the child

---

### `josh lane:limit` · `josh lli`

> **Audience:** developer · **Side effects:** files

`[<limit>] [--reset]`

Change a live backlogrun’s lane limit without stopping it, or print the limit, lanes in use and free lanes

---

### `josh lane:list`

> **Audience:** automation · **Side effects:** none

_No arguments._

List the open lanes: which issue, which ports, and where each one is

---

### `josh lane:open`

> **Audience:** automation · **Side effects:** files, git

`<issue> [options]`

Open a lane: a linked work tree with its own branch and its own port seed

---

### `josh lane:output`

> **Audience:** automation · **Side effects:** files

`<issue> [path]`

Record, or read back, where the unit running a lane’s child writes

---

### `josh lane:prune`

> **Audience:** automation · **Side effects:** files, git

_No arguments._

Close every lane an interruption left without its work tree, then sweep unregistered leftovers under the lanes root

---

### `josh lane:sample` · `josh lsm`

> **Audience:** maintainer · **Side effects:** files

`[--every <seconds>]`

Record the machine load (load average, swap, free memory, working lanes) to the lane ledger — a backlogrun samples itself, this is for a reading outside one

---

### `josh lane:stats` · `josh lst`

> **Audience:** maintainer · **Side effects:** none

`--period <days> [--limit <lane-limit>]`

Print one table row of lane throughput, gate duration and machine load over a period, and the per-stage durations of a lane under it

---

### `josh oracle:list`

> **Audience:** automation · **Side effects:** none

_No arguments._

Print the decision oracles — commands that answer a rule question mechanically

---

### `josh pkg:scout`

> **Audience:** automation · **Side effects:** network

`<keywords> [--size <n>]`

Rank package candidates by measured metrics so the Package-First tier decision is read, not judged

---

### `josh read:files`

> **Audience:** automation · **Side effects:** none

`<path> [<path> ...]`

Read several files in one call so edit targets fold into one turn

---

### `josh read:set`

> **Audience:** automation · **Side effects:** none

`[<entry>] [--json]`

Print what an entry point reads before it starts, and what that read costs

---

### `josh repo:party`

> **Audience:** automation · **Side effects:** none

`[<owner/repo>]`

Say whether a repository is first-party or third-party by owner equality (computed, not judged)

---

### `josh report:lint`

> **Audience:** automation · **Side effects:** none

`(reads stdin)`

Check a two-layer work summary on stdin against its mechanical format rules

---

### `josh retrospective` · `josh rtr`

> **Audience:** maintainer · **Side effects:** none · **kit only**

_No arguments._

Aggregate a finished run's cost, review findings, observation ledger and events into one digest

---

### `josh review:attest`

> **Audience:** automation · **Side effects:** files

`<nonce> | --check`

Record, or verify, which checkout a /code-review actually read

---

### `josh review:brief`

> **Audience:** automation · **Side effects:** files

`[--round <1|2>] | --level-only [--staged] [--json]`

Print the whole /code-review invocation: level, what the gate already proved, target (--level-only for the level alone)

---

### `josh review:round2`

> **Audience:** automation · **Side effects:** none

`[--round-1-closed] [--json]`

Say whether the second /code-review round is due, or may be skipped entirely

---

### `josh rule:guard`

> **Audience:** automation · **Side effects:** none

_No arguments._

Claude Code hook: deliver a trigger-delivered rule at the call that binds it (reads the tool call on stdin)

---

### `josh rule:list`

> **Audience:** automation · **Side effects:** none

_No arguments._

Print the trigger-delivered rules — each one's source, firing call and silent turn — from the guard rows

---

### `josh rule:value` · `josh ruv`

> **Audience:** developer · **Side effects:** files

`[--refresh]`

Print each delivered rule's unaided compliance — runs reached, kept rate, refusals

---

### `josh run:add`

> **Audience:** automation · **Side effects:** network, files

`<issue...> [--no-priority]`

Add issues to a live backlogrun, ahead of the queue unless --no-priority

---

### `josh run:board`

> **Audience:** automation · **Side effects:** files, network

`[--once | --chat | --every <minutes>]`

Draw a live board of the running backlogrun, redrawn every second

---

### `josh run:carry`

> **Audience:** automation · **Side effects:** files

`<operation> [arguments...]`

Carry one invocation’s budget across its own session cuts

---

### `josh run:cut`

> **Audience:** automation · **Side effects:** files

`[--resume] <issue> [--impl] [--handoff <path>]`

Cut a lane child before the gate and resume a fresh process

---

### `josh run:ending`

> **Audience:** automation · **Side effects:** network

`<issue> --output <path> [--repo <owner/repo>]`

Classify how a dispatched lane child ended (merged, cut, abandoned, unreadable)

---

### `josh run:entry`

> **Audience:** automation · **Side effects:** git, network, files

`<issue> [--to <command>]`

Open a run in one call: claim the tree, read the budget, bundle the reads, decide the pre-implementation step

---

### `josh run:event`

> **Audience:** automation · **Side effects:** files

`--append <kind> <text> | --from|--follow <n> | --watch [<n>] | --last`

Append to, read or watch the run’s append-only event stream (--append <kind> <text> | --from|--follow <n> | --watch [<n>] | --last)

---

### `josh run:hold`

> **Audience:** automation · **Side effects:** files

`[<issue> [--fullrun | --halfrun-stop | --prrun-stop]]`

Claim this working tree for a run, or say which run already holds it

---

### `josh run:liveness`

> **Audience:** automation · **Side effects:** processes

`<issue> --output <path> [options]`

Say whether a delegated unit is still working, or stopped without reporting

---

### `josh run:merge`

> **Audience:** automation · **Side effects:** git, network

`<issue> [options]`

Collapse a backlogrun merge event into one call: confirm the child, do the post-merge steps, offer the next child

---

### `josh run:next`

> **Audience:** automation · **Side effects:** network

`<issue>`

Print the next step a fullrun takes, computed from the run’s state

---

### `josh run:prep`

> **Audience:** automation · **Side effects:** network

`<issue>`

Bundle a run’s pre-edit reads: body, comments, state, dependency scope

---

### `josh run:progress`

> **Audience:** automation · **Side effects:** files

`[--once | --wait] [--interval <minutes>] [--hours <hours>] [--repo <owner/repo>] [--output <path>] | --mark | --path`

Report an unattended run’s progress once it has gone quiet for an interval

---

### `josh run:release`

> **Audience:** automation · **Side effects:** files

`[issue|--force]`

Release this working tree's run record

---

### `josh run:report`

> **Audience:** automation · **Side effects:** files, network

_No arguments._

Generate the session-facing report for this invocation from the run’s event stream (merges, parks, cuts) with the release tail — the same text josh notify sends

---

### `josh run:review`

> **Audience:** automation · **Side effects:** processes, files

`[--join]`

Start the gate in the background and print the /code-review brief in one call so the two overlap (--join to join the gate and check its verdict)

---

### `josh run:status`

> **Audience:** automation · **Side effects:** network

`<issue> [--repo <owner/repo>]`

Bundle a run’s read-only status: issue state, cost verdict, carry counters

---

### `josh run:step`

> **Audience:** automation · **Side effects:** network, files

`<issue>`

Print the run’s next single action, computed from the event stream, carry record and issue state

---

### `josh run:stranded`

> **Audience:** automation · **Side effects:** processes, notifications

_No arguments._

Report whether the run is stranded — budget handed off, owner gone, and no supervisor watching

---

### `josh run:tail`

> **Audience:** automation · **Side effects:** git, network

`[<issue> ...]`

Close a run in one call: return to the default branch, commit the observation ledger, read the citations, decide the release scope

---

### `josh run:tidy`

> **Audience:** automation · **Side effects:** git, network, files

_No arguments._

Close merged lanes and drop stashes whose issues are all merged

---

### `josh run:wake`

> **Audience:** automation · **Side effects:** processes, notifications

`[options]`

Wake the next session of a cut backlogrun from outside the conversation

---

### `josh run:watcher:guard`

> **Audience:** automation · **Side effects:** none

_No arguments._

Guard: exits non-zero when lane children are in-flight but the watcher has not pinged recently

---

### `josh ship`

> **Audience:** automation · **Side effects:** git, network

`"<title> #<N>" [<follow-up-N> ...] [--cite <N>] [--review] [--detach] [--body-file <path>] [--notify-message <text> | --notify-message-file <path>] | --log <N>`

Ship a change in one call: gate, commit/push/PR, the CI-wait merge and the report bookkeeping, stopping at the first failed step

---

### `josh split:assess`

> **Audience:** automation · **Side effects:** none

`[--json]`

Measure the branch change size (tests excluded) and answer the split assessment size question: split | single

---

### `josh stash:pop`

> **Audience:** automation · **Side effects:** git

`<message>`

Pop the stash matching this message, not whichever a shared stack has on top

---

### `josh time` · `josh tm`

> **Audience:** maintainer · **Side effects:** none · **kit only**

`[options]`

Report where a run's wall clock went: model wait, tool execution, human wait

---

### `josh time:density` · `josh tmd`

> **Audience:** maintainer · **Side effects:** none · **kit only**

`[--lanes <n>] [--path <dir>]`

Report tool calls per round trip across the recent lane sessions
