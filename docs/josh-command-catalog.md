# josh CLI — Command Catalog

Auto-generated — do not edit.
Run `tsx scripts/document/generate-catalog.ts` to regenerate.

## Development

### `josh batch:guard` · `josh bg`

> **Audience:** automation · **Side effects:** none

_No arguments._

Claude Code hook: refuse a third consecutive single-call turn (reads the tool call on stdin)

---

### `josh bytes` · `josh by`

> **Audience:** developer · **Side effects:** none

`<files...>`

Print an agent-read document's byte size against its ceiling and the headroom left

---

### `josh check` · `josh c`

> **Audience:** developer · **Side effects:** processes

`[arguments...]`

Type-check TypeScript project

---

### `josh cspell:dot` · `josh sd`

> **Audience:** developer · **Side effects:** processes

_No arguments._

Run spell check including dotfiles

---

### `josh e2e:retry-check` · `josh er`

> **Audience:** automation · **Side effects:** none

_No arguments._

Report whether the preview server crashed during a failed E2E attempt (CI)

---

### `josh format` · `josh f`

> **Audience:** developer · **Side effects:** files, processes

_No arguments._

Format code with prettier and eslint

---

### `josh format:edited` · `josh fd`

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

Check code with prettier and eslint

---

### `josh lint:related` · `josh lr`

> **Audience:** developer · **Side effects:** processes

`[files...]`

Check only the changed files with prettier and eslint (whole tree on fallback)

---

### `josh port` · `josh pt`

> **Audience:** developer · **Side effects:** none

`<dev|preview>`

Print the PORT_SEED-resolved dev or preview port

---

### `josh pretool:guard` · `josh ptg`

> **Audience:** automation · **Side effects:** none

_No arguments._

Claude Code hook: the batch, investigation and rule guards in one process (reads the tool call on stdin)

---

### `josh session:lang` · `josh sl`

> **Audience:** automation · **Side effects:** none

_No arguments._

Claude Code hook: print the resolved JOSH_SESSION_LANG (defaults to ja) for the session context

---

### `josh stop:guard` · `josh sg`

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

_No arguments._

Report whether the working-tree change needs a test (required/exempt/satisfied)

---

### `josh test:e2e` · `josh te`

> **Audience:** developer · **Side effects:** processes

`[filters...]`

Run E2E tests with Playwright (skips when absent or no e2e files)

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

### `josh init` · `josh i`

> **Audience:** developer · **Side effects:** files, processes

_No arguments._

Initialize config in a new project

---

### `josh propagate` · `josh pg`

> **Audience:** maintainer · **Side effects:** files, network

`[--dry-run] [--skip-publish-wait]`

Carry the published release into every consumer repository next to this one

---

### `josh sync` · `josh sy`

> **Audience:** developer · **Side effects:** files

_No arguments._

Sync config files

---

### `josh sync:scope` · `josh sys`

> **Audience:** automation · **Side effects:** none

`[--staged] [--json]`

Say whether this change touches a file josh sync distributes

## Workflow

### `josh followup` · `josh fu`

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

Checkout default branch and pull latest (refuses inside a lane)

---

### `josh measure:rerun` · `josh mrr`

> **Audience:** automation · **Side effects:** processes, files

`<path>`

Re-run a merged issue’s baseline command and print the before/after pair

---

### `josh notify` · `josh nf`

> **Audience:** automation · **Side effects:** notifications

`--task-type <type> --body <text>`

Send Telegram notification

---

### `josh observations:flush` · `josh obf`

> **Audience:** automation · **Side effects:** git, network

_No arguments._

Commit the observation ledger as a pull request of its own, and merge it

---

### `josh pr` · `josh gp`

> **Audience:** developer · **Side effects:** network

`<message>`

Create PR only (skip commit and push)

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

`[version]`

Release the merges main has taken since the version last changed

---

### `josh release:scope` · `josh res`

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

### `josh audit:provision` · `josh ap`

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

> **Audience:** maintainer · **Side effects:** files, network, processes

_No arguments._

Update pnpm, dependencies, and run security audit

---

### `josh latest:corepack` · `josh lc`

> **Audience:** maintainer · **Side effects:** files, network

_No arguments._

Update pnpm via corepack to the latest release on the current major

---

### `josh latest:guard` · `josh lg`

> **Audience:** automation · **Side effects:** files

_No arguments._

Refuse josh latest inside a lane (the update stamp is keyed to the project root)

---

### `josh latest:scope` · `josh ls`

> **Audience:** automation · **Side effects:** files

`[--record] [--json]`

Say whether this run has to update dependencies, from when josh latest last finished (--record notes a run)

---

### `josh latest:update` · `josh lu`

> **Audience:** maintainer · **Side effects:** files, network

_No arguments._

Update all dependencies to latest

---

### `josh overrides` · `josh ov`

> **Audience:** maintainer · **Side effects:** files

`[--save]`

Check pnpm overrides for drift

---

### `josh reconcile-templates` · `josh rt`

> **Audience:** maintainer · **Side effects:** files

_No arguments._

Record template source hashes (--check to verify drift)

## Git hooks

### `josh check-commit-message` · `josh cm`

> **Audience:** automation · **Side effects:** none

`[<message-file>]`

Git hook: validate commit message

---

### `josh pre-commit-type-check` · `josh ptc`

> **Audience:** automation · **Side effects:** processes

_No arguments._

Git hook: type-check, reusing a green gate recorded on the committed tree

---

### `josh pre-push-unit` · `josh ppu`

> **Audience:** automation · **Side effects:** processes

_No arguments._

Git hook: run unit tests, reusing a green gate recorded on the pushed tree

---

### `josh prevent-main-commit` · `josh pm`

> **Audience:** automation · **Side effects:** none

_No arguments._

Git hook: block commits to main

---

### `josh secretlint-scan` · `josh ss`

> **Audience:** automation · **Side effects:** none

`[paths...]`

Git hook: scan staged files for secrets

## AI tools

### `josh auto-ok:next` · `josh ao`

> **Audience:** automation · **Side effects:** network

`[--exclude <n>[,<n>...]] [--label <name>]`

Print the next opted-in issue an unattended run may pick up outside an epic

---

### `josh backlog:budget` · `josh bb`

> **Audience:** automation · **Side effects:** none

`[options]`

Say whether a backlogrun may start more work, keep watching, or finish

---

### `josh backlog:next` · `josh bl`

> **Audience:** automation · **Side effects:** network

`[--exclude <n>[,<n>...]] [--repo <owner/repo>]`

Order the whole opted-in backlog: auto-ok issues and the children of auto-ok epics

---

### `josh backlog:offer` · `josh blo`

> **Audience:** automation · **Side effects:** network

`[options]`

Collapse a backlogrun loop-head event into one call: read backlog:next, ask backlog:budget, return the verdict and any issues to start

---

### `josh backlog:plan` · `josh blp`

> **Audience:** automation · **Side effects:** network

`[issue...] [--only]`

Print the whole backlog as a plan: ready now, waiting on what, waiting on a person, out of scope

---

### `josh clone:scan` · `josh cs`

> **Audience:** automation · **Side effects:** files

_No arguments._

Count code duplication across files and first-party repositories, printing each clone as file:line pairs

---

### `josh cost` · `josh co`

> **Audience:** automation · **Side effects:** none

`[--cut|--over]`

Report a run's token and credit cost from Claude Code's session transcripts

---

### `josh delegate` · `josh dg`

> **Audience:** automation · **Side effects:** none

`<step> | --list`

Say whether a run step may go to a cheaper execution tier

---

### `josh doc:read` · `josh dcr`

> **Audience:** automation · **Side effects:** none

`<file>`

Read a whole document safely: print it, or point at the Read tool when over the Bash cap

---

### `josh doc:section` · `josh ds`

> **Audience:** automation · **Side effects:** none

`<file> <heading>`

Print one section of a markdown document, for a `file.md` → "Heading" reference

---

### `josh epic` · `josh ep`

> **Audience:** automation · **Side effects:** network

`<title> <issue...> [--ordered]`

Create an epic issue from its child issue numbers

---

### `josh epic:audit` · `josh ea`

> **Audience:** automation · **Side effects:** network

`<epic>`

Audit an epic's children against each other for contradictions

---

### `josh epic:bundle` · `josh eb`

> **Audience:** automation · **Side effects:** network

`<issue>`

Say whether a newly filed issue belongs with ones already in the backlog

---

### `josh epic:check` · `josh ec`

> **Audience:** automation · **Side effects:** network

`<epic>`

Check an epic issue against the tracking requirements

---

### `josh epic:next` · `josh en`

> **Audience:** automation · **Side effects:** network

`<epic>`

List an epic's runnable children, bundled per repository

---

### `josh eval` · `josh ev`

> **Audience:** maintainer · **Side effects:** processes, network · **kit only**

`[scenario...]`

Run the agent rule-compliance scenarios (real Claude sessions)

---

### `josh investigation:guard` · `josh ig`

> **Audience:** automation · **Side effects:** none

_No arguments._

Claude Code hook: refuse a read once the unedited-read threshold is reached again (reads the tool call on stdin)

---

### `josh issue:backlinks` · `josh ibl`

> **Audience:** automation · **Side effects:** network

`<issue>`

Classify an origin issue’s upstream backlinks: ok, missing, or wrong heading

---

### `josh issue:lint` · `josh iln`

> **Audience:** automation · **Side effects:** files

`<path>`

Check an issue body file for the template's required headings

---

### `josh issue:read` · `josh ird`

> **Audience:** automation · **Side effects:** network

`<issue...>`

Print each issue's title, body and every comment on it, in one call

---

### `josh issue:scout` · `josh isc`

> **Audience:** automation · **Side effects:** network

`<title> [--body <summary>]`

Before filing: say whether an issue like this exists and which epic it belongs to

---

### `josh issue:state` · `josh ist`

> **Audience:** automation · **Side effects:** network

`<issue...> [--repo <owner/repo>]`

Print each issue's state and labels, in the spelling the documents compare against

---

### `josh lane:await` · `josh lna`

> **Audience:** automation · **Side effects:** processes

`<issue> [<issue>...]`

Block until any of the named in-flight lane children completes; prints which one finished

---

### `josh lane:close` · `josh lnc`

> **Audience:** automation · **Side effects:** files, git

`<issue>`

Close a lane, leaving no work tree, branch or directory behind

---

### `josh lane:dispatch` · `josh lnd`

> **Audience:** automation · **Side effects:** processes

`<issue> <prompt>`

Start a lane’s child as a detached process that outlives this session

---

### `josh lane:launch` · `josh lnla`

> **Audience:** automation · **Side effects:** files, git, processes

`<issue> [--stash <message>]`

Collapse a backlogrun lane-start event into one call: open the lane, pop and re-install on the first, dispatch the child

---

### `josh lane:list` · `josh lnl`

> **Audience:** automation · **Side effects:** none

_No arguments._

List the open lanes: which issue, which ports, and where each one is

---

### `josh lane:open` · `josh lno`

> **Audience:** automation · **Side effects:** files, git

`<issue> [options]`

Open a lane: a linked work tree with its own branch and its own port seed

---

### `josh lane:output` · `josh lnv`

> **Audience:** automation · **Side effects:** files

`<issue> [path]`

Record, or read back, where the unit running a lane’s child writes

---

### `josh lane:prune` · `josh lnp`

> **Audience:** automation · **Side effects:** files, git

_No arguments._

Close every lane an interruption left without its work tree

---

### `josh oracle:list` · `josh ol`

> **Audience:** automation · **Side effects:** none

_No arguments._

Print the decision oracles — commands that answer a rule question mechanically

---

### `josh read:files` · `josh rf`

> **Audience:** automation · **Side effects:** none

`<path> [<path> ...]`

Read several files in one call so edit targets fold into one turn

---

### `josh read:set` · `josh rs`

> **Audience:** automation · **Side effects:** none

`[<entry>] [--json]`

Print what an entry point reads before it starts, and what that read costs

---

### `josh repo:party` · `josh rpy`

> **Audience:** automation · **Side effects:** none

`[<owner/repo>]`

Say whether a repository is first-party or third-party by owner equality (computed, not judged)

---

### `josh report:lint` · `josh rl`

> **Audience:** automation · **Side effects:** none

`(reads stdin)`

Check a two-layer work summary on stdin against its mechanical format rules

---

### `josh review:attest` · `josh ra`

> **Audience:** automation · **Side effects:** files

`<nonce> | --check`

Record, or verify, which checkout a /code-review actually read

---

### `josh review:brief` · `josh rb`

> **Audience:** automation · **Side effects:** files

`[--round <1|2>] | --level-only [--staged] [--json]`

Print the whole /code-review invocation: level, what the gate already proved, target (--level-only for the level alone)

---

### `josh review:round2` · `josh r2`

> **Audience:** automation · **Side effects:** none

`[--round-1-closed] [--json]`

Say whether the second /code-review round is due, or may be skipped entirely

---

### `josh rule:guard` · `josh rug`

> **Audience:** automation · **Side effects:** none

_No arguments._

Claude Code hook: deliver a trigger-delivered rule at the call that binds it (reads the tool call on stdin)

---

### `josh run:carry` · `josh rc`

> **Audience:** automation · **Side effects:** files

`<operation> [arguments...]`

Carry one invocation’s budget across its own session cuts

---

### `josh run:cut` · `josh rct`

> **Audience:** automation · **Side effects:** files

`[--resume] <issue>`

Cut a lane child before the gate and resume a fresh process

---

### `josh run:ending` · `josh red`

> **Audience:** automation · **Side effects:** network

`<issue> --output <path> [--repo <owner/repo>]`

Classify how a dispatched lane child ended (merged, cut, abandoned, unreadable)

---

### `josh run:hold` · `josh rh`

> **Audience:** automation · **Side effects:** files

`[issue]`

Claim this working tree for a run, or say which run already holds it

---

### `josh run:liveness` · `josh rv`

> **Audience:** automation · **Side effects:** processes

`<issue> --output <path> [options]`

Say whether a delegated unit is still working, or stopped without reporting

---

### `josh run:merge` · `josh rmg`

> **Audience:** automation · **Side effects:** git, network

`<issue> [options]`

Collapse a backlogrun merge event into one call: confirm the child, do the post-merge steps, offer the next child

---

### `josh run:next` · `josh rn`

> **Audience:** automation · **Side effects:** network

`<issue>`

Print the next step a fullrun takes, computed from the run’s state

---

### `josh run:prep` · `josh rp`

> **Audience:** automation · **Side effects:** network

`<issue>`

Bundle a run’s pre-edit reads: body, comments, state, dependency scope

---

### `josh run:progress` · `josh rg`

> **Audience:** automation · **Side effects:** files

`[--wait|--mark]`

Report an unattended run’s progress once it has gone quiet for an interval

---

### `josh run:release` · `josh rr`

> **Audience:** automation · **Side effects:** files

`[issue|--force]`

Release this working tree's run record

---

### `josh run:review` · `josh rrv`

> **Audience:** automation · **Side effects:** processes, files

`[--join]`

Start the gate in the background and print the /code-review brief in one call so the two overlap (--join to join the gate and check its verdict)

---

### `josh run:status` · `josh rst`

> **Audience:** automation · **Side effects:** network

`<issue> [--repo <owner/repo>]`

Bundle a run’s read-only status: issue state, cost verdict, carry counters

---

### `josh run:wake` · `josh rw`

> **Audience:** automation · **Side effects:** processes, notifications

`[options]`

Wake the next session of a cut backlogrun from outside the conversation

---

### `josh run:watcher:guard` · `josh rwg`

> **Audience:** automation · **Side effects:** none

_No arguments._

Guard: exits non-zero when lane children are in-flight but the watcher has not pinged recently

---

### `josh stash:pop` · `josh sp`

> **Audience:** automation · **Side effects:** git

`<message>`

Pop the stash matching this message, not whichever a shared stack has on top

---

### `josh time` · `josh tm`

> **Audience:** maintainer · **Side effects:** none · **kit only**

`[options]`

Report where a run's wall clock went: model wait, tool execution, human wait
