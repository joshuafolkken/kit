# josh CLI — Command Catalog

Auto-generated — do not edit.
Run `pnpm josh command:derive` to regenerate.

## Development

| Command | Arguments | Audience | Side effects | Description |
| --- | --- | --- | --- | --- |
| `josh behavior` · `josh bh` | — | developer | files | Check the current run's recorded transcript against the behavior assertions (no model call) |
| `josh bytes` · `josh by` | `<files...>` | developer | none | Print an agent-read document's byte size against its ceiling and the headroom left |
| `josh check` · `josh c` | `[arguments...]` | developer | processes | Type-check with tsc (skips a basic project with no TypeScript to check) |
| `josh check:related` · `josh cr` | — | developer | processes | Run related lint, type and dotfile spelling checks in parallel, and the unit tests once lint passes |
| `josh codex:hook-adapter` | `<pretool\|posttool>` | automation | none | Codex hook: run the pretool or posttool guard on a Codex payload (reads the tool call on stdin) |
| `josh cspell:dot` · `josh sd` | — | developer | processes | Run spell check including dotfiles |
| `josh e2e:retry-check` | — | automation | none | Report whether the preview server crashed during a failed E2E attempt (CI) |
| `josh exports:unused` · `josh eu` | — | developer | none | Report exported namespace members nothing reads (kit only; a consumer project skips it) |
| `josh format` · `josh f` | — | developer | files, processes | Format code with prettier and eslint (skips a tool a basic project lacks) |
| `josh format:edited` | — | automation | files, processes | Claude Code hook: format the file just edited (reads the tool call on stdin) |
| `josh gate` · `josh ga` | `[--verbose\|--force\|--no-unit\|--static-group=<group>]` | developer | files, processes | Run lint, type check, spell check and unit tests concurrently |
| `josh lines` · `josh ln` | `<files...>` | developer | none | Print a file's code lines against the max-lines limit and the headroom left |
| `josh lint` · `josh l` | `[--changed]` | developer | processes | Check code with prettier and eslint (skips a tool a basic project lacks) |
| `josh lint:related` · `josh lr` | `[files...]` | developer | processes | Check only the changed files with prettier and eslint, and in kit the source guard tests (whole tree on fallback) |
| `josh metrics` · `josh mt` · **kit only** | `[--no-startup \| --totals-only [--rerecord] \| --accept --reason "<why>"]` | developer | files | Print repository-wide quality totals and durations, and fail when a total grew past the merge-base or a duration past its baseline |
| `josh port` · `josh pt` | `<dev\|preview>` | developer | none | Print the PORT_SEED-resolved dev or preview port |
| `josh pr:classification` | — | automation | none | Require one release classification on a pull request |
| `josh pretool:guard` | — | automation | none | Claude Code hook: the batch, investigation and rule guards in one process (reads the tool call on stdin) |
| `josh refactor:scan` | — | automation | processes | List refactoring candidates in the changed scope by category and answer clear/candidates |
| `josh rename` | `<old-identifier> <new-identifier> [--import <old-specifier> <new-specifier>] <file...>` | automation | files, processes | Rename an identifier, and the import specifier it moved with, across files through the TypeScript parse tree |
| `josh session:lang` | — | automation | none | Claude Code hook: print a non-default JOSH_SESSION_LANG for the session context, and the run:board reply rule while a backlogrun is live (otherwise nothing) |
| `josh stop:guard` | — | automation | none | Claude Code Stop hook: send the hold notify and release the hold itself; block on the rules that need the model (reads the Stop payload on stdin) |
| `josh test` · `josh t` | — | developer | processes | Run unit and E2E tests |
| `josh test:declared` · `josh td` | `[--match]` | developer | processes | Report whether the working-tree change needs a test (required/exempt/satisfied); --match checks Step 0 declarations on stdin |
| `josh test:e2e` · `josh te` | `[filters...]` | developer | processes | Run E2E tests with Playwright (skips when absent or no e2e files) |
| `josh test:pinned` · `josh tpn` | `[--max <n>] [--record <token>] [--origin <run-review\|pre-detach\|manual>] [--first-unpinned]` | developer | git, processes | Revert each changed hunk outside tests and fixtures only they reach, and replace each added file's top-level function bodies with a throw, in a HEAD worktree, run the related tests, and list what no test went red on |
| `josh test:reach` | `<files...>` | automation | none | Print how many test files each file's imports reach — the count test:related sizes its claim by — one '<count> <file>' line per file |
| `josh test:red` · `josh trd` | — | developer | git, processes | Run the changed unit tests against the pre-fix tree (merge-base worktree) and report red/green/no-test/stopped/test-only |
| `josh test:related` · `josh tr` | `[files...]` | developer | processes | Run only the unit tests related to the changed files (full suite on fallback) |
| `josh test:unit` · `josh tu` | `[filters...]` | developer | processes | Run unit tests with Vitest (without Vitest: a basic project runs its own test script, others skip; fails when Vitest has no tests) |

## Project

| Command | Arguments | Audience | Side effects | Description |
| --- | --- | --- | --- | --- |
| `josh adopt` · `josh ad` | `[--dry-run]` | developer | files, git, network, processes | Upgrade the @joshuafolkken toolkits and other dependencies here, open the PR |
| `josh auth:setup` · `josh as` | `[--check]` | maintainer | network, processes | Save the long-lived Claude Code token `claude setup-token` prints in the macOS keychain, for josh fresh:run |
| `josh dogfood:commit` · **kit only** | `<dir>` | automation | files, git | Make the first commit of a dogfood run's own kit-test-* project |
| `josh fresh:run` · `josh fr` | `<pattern> \| --spec <file.json> [--package-version <version>] [--log-dir <dir>] [--rebuild] \| --list` | maintainer | files, network, processes | Run an install scenario in a Docker container of a machine with nothing installed, and keep the log |
| `josh init` · `josh i` | `[--profile basic\|full] [--no-install] [--dry-run]` | developer | files, network, processes | Initialize config in a new project |
| `josh profile` · `josh pf` | `[--profile basic\|full]` | developer | files | Show the project profile and the reason for it |
| `josh propagate` · `josh pg` | `[--dry-run] [--skip-publish-wait] [--target <repo>]` | maintainer | files, network | Carry the published release into every consumer repository next to this one |
| `josh sonar:hotspots` | `<PR>` | automation | network | Fetch SonarCloud hotspots on a pull request and print each one's Step B disposition |
| `josh sonar:new-code` | `<PR>` | automation | network | Fail when a pull request adds any new SonarCloud issue or duplicated block |
| `josh start` · `josh st` | `[--profile basic\|full] [--yes] [--github] [--public] [--dry-run] [--init-command <command>] [--push-preflight-command <command>]` | developer | files, git, network, processes | Set a project up for the GitHub Issue workflow, from git init to the setup PR |
| `josh sync` · `josh sy` | — | developer | files | Sync config files |
| `josh sync:scope` | `[--staged] [--json]` | automation | none | Say whether this change touches a file josh sync distributes |
| `josh ui:routes` | `[--staged]` | automation | none | List the screenshot-target routes the current change touches |
| `josh uninstall` · `josh un` | `[--profile basic\|full] [--yes]` | developer | files, processes | Remove what kit added to a project and list what is left to review by hand |

## Workflow

| Command | Arguments | Audience | Side effects | Description |
| --- | --- | --- | --- | --- |
| `josh followup` | `<title> [--notify-message <text>]` | automation | git, network, notifications | Follow-up git workflow |
| `josh git` · `josh g` | `[-y] <message>` | developer | git, network | Git workflow helper |
| `josh main:merge` · `josh mm` | — | developer | git, network | Merge origin default branch into the current branch |
| `josh main:sync` · `josh ms` | — | developer | git, network | Checkout default branch, pull latest, and prune merged remote-gone branches (refuses inside a lane) |
| `josh measure:rerun` | `<issue-number>` | automation | network, processes, files | Re-run a merged issue’s baseline command and print the before/after pair |
| `josh notify` | `[--task-type <type>] [--body <text> \| --body-file <path>] [--issue-url <url>] [--pr-url <url>] [--issue-title <text>] [--repo-name <name>] [--recommended <text>] [--alternative <text>]...` | automation | notifications | Send Telegram notification |
| `josh observation:record` | `<key> <depth> <where> <what> [--checkout <path>]` | automation | files | Record an observation sighting and answer whether it is now filed |
| `josh observations:flush` | — | automation | git, network | Commit the observation ledger as a pull request of its own, and merge it |
| `josh pr` · `josh gp` | `<message>` | developer | network | Create PR only (skip commit and push) |
| `josh review:findings` · `josh rvf` | — | developer | files | Count review findings by category from the observation ledger |
| `josh review:record` | `--issue <N> [--comment \| --interaction] [<category>:<severity>:<file>[ — <reason>] ...] \| --check [--interaction] --issue <N>` | automation | files, network | Record a review round’s findings, or check a round was recorded |
| `josh review:stops` · `josh rvs` | `[--period <days>]` | developer | none | List the review findings that stopped a josh ship over a period, by kind, file:line and first sentence |

## Versioning

| Command | Arguments | Audience | Side effects | Description |
| --- | --- | --- | --- | --- |
| `josh bump` · `josh bp` | `[major\|minor\|patch]` | maintainer | files | Bump package version |
| `josh ranges` · `josh r` | — | developer | network | Check that every published dependency range still resolves for a consumer and no peer range falls below an installed toolkit |
| `josh release` · `josh re` | `[--dry-run]` | maintainer | git, network, release | Release the merges main has taken since the version last changed |
| `josh release:github` | — | automation | network, release | Create the GitHub Release for a published tag, with generated notes |
| `josh release:scope` | `[--json]` | automation | none | Say whether a release is owed, from the unreleased merges on main |
| `josh version` · `josh v` | `[--upgrade]` | developer | files, network, processes | Show kit versions; --upgrade updates the global and project install |

## Maintenance

| Command | Arguments | Audience | Side effects | Description |
| --- | --- | --- | --- | --- |
| `josh audit` · `josh a` | — | developer | processes | Run security audit |
| `josh audit:provision` | — | automation | files, network | Install the pinned osv-scanner when the audit cannot find one (no-op if present) |
| `josh command:derive` · `josh cdv` · **kit only** | — | maintainer | files | Write every artifact the command map derives — usage spans, catalog, snapshot, docs/why.md counts — and print page bytes against their ceilings |
| `josh doctor` · `josh dr` | `[--fix]` | developer | files | Diagnose PATH shadowing of the global josh and show the discovered repository map (--fix reclaims a stale shim) |
| `josh latest` · `josh u` | — | developer | files, network, processes | Update dependencies, run security audit, then update pnpm |
| `josh latest:corepack` · `josh lc` | — | developer | files, network | Update pnpm on the current major while preserving the integrity pin |
| `josh latest:guard` | — | automation | files | Refuse josh latest inside a lane (the update stamp is keyed to the project root) |
| `josh latest:if-required` | — | automation | files, network, processes | Run josh latest only when latest:scope answers required, stashing around it |
| `josh latest:scope` | `[--record] [--json]` | automation | files | Say whether this run has to update dependencies, from when josh latest last finished (--record notes a run) |
| `josh latest:update` · `josh lu` | — | developer | files, network | Update all dependencies to latest |
| `josh lockfile:policy` · **kit only** | — | automation | network | Verify the lockfile against pnpm's supply-chain policy (minimumReleaseAge) when it or the policy moved from the merge-base |
| `josh overrides` · `josh ov` | `[--save]` | developer | files | Check pnpm overrides for drift |
| `josh reconcile-templates` · `josh rt` | — | maintainer | files | Record template source hashes (--check to verify drift) |
| `josh ruleset:check` · `josh rc` | `[--apply]` | maintainer | network | Check that the default branch requires every status check kit's workflows report (--apply adds the missing ones) |

## Git hooks

| Command | Arguments | Audience | Side effects | Description |
| --- | --- | --- | --- | --- |
| `josh check-commit-message` | `[<message-file>]` | automation | none | Git hook: validate commit message |
| `josh pre-commit-lint` | `<cspell\|prettier\|eslint> [paths...]` | automation | files | Git hook: run cspell, prettier or eslint over staged files from a content cache |
| `josh pre-commit-type-check` | — | automation | processes | Git hook: type-check, reusing a green gate recorded on the committed tree |
| `josh pre-push-unit` | — | automation | processes | Git hook: run unit tests, reusing a green gate recorded on the pushed tree |
| `josh prevent-main-commit` | — | automation | none | Git hook: block commits to main |
| `josh reserved-run` | `<weight> [--memory <MB>] -- <command...>` | automation | processes | Git hook: run a command while holding a place in the machine-wide core budget |
| `josh secretlint-scan` | `[paths...]` | automation | none | Git hook: scan staged files for secrets |

## AI tools

| Command | Arguments | Audience | Side effects | Description |
| --- | --- | --- | --- | --- |
| `josh auto-ok:judge` | `[--apply <n> (--lane \| --solo) \| --decline <n> --reason <text>]` | automation | network | List the open issues backlogrun owes an auto-ok judgement, or record one (--apply / --decline) |
| `josh auto-ok:next` | `[--exclude <n>[,<n>...]] [--label <name>]` | automation | network | Print the next opted-in issue an unattended run may pick up outside an epic |
| `josh backlog:budget` | `[options]` | automation | none | Say whether a backlogrun may start more work, keep watching, or finish |
| `josh backlog:drive` | `--owner <pid> [options]` | automation | network | Drive backlogrun through offer, launch and merge; restore this run’s lanes and report when complete |
| `josh backlog:next` | `[--exclude <n>[,<n>...]] [--repo <owner/repo>]` | automation | network | Order the whole opted-in backlog: auto-ok issues and the descendants of auto-ok epics, transitively through nested epics |
| `josh backlog:offer` | `[options]` | automation | files, network, processes | Collapse a backlogrun loop-head event into one call: read backlog:next, ask backlog:budget, return the verdict and any issues to start |
| `josh backlog:plan` | `[issue...] [--only] [--waves] [--exclude <n>[,<n>...]]` | automation | network | Print the whole backlog as a plan: ready now, waiting on what, waiting on a person, out of scope |
| `josh backlogrun` · `josh blr` | `[<n>...] [--only] [--max <n>] [--idle <minutes>] [--agent claude\|codex] \| --stop \| --restart` | developer | files, network, processes | Start a backlogrun in the background and show its board; with one already running, only show the board, or replace it when it is idle and the invocation differs; --stop stops it; --restart replaces its processes and keeps its record |
| `josh cases` | `<path...>` | automation | files | Read changed paths and print the boundaries crossed and their mandatory abnormal cases: network \| process \| fs \| time \| state \| env \| none |
| `josh clone:scan` | — | automation | files | Count code duplication across files and first-party repositories, printing each clone as file:line pairs |
| `josh cost` | `(--cut \| --over <tokens-per-request>) [--path <dir>]` | automation | none | Say whether the next turn of a run crosses the context-cut threshold (--cut) or a given tokens-per-request figure (--over) |
| `josh cost:audit` · `josh ca` · **kit only** | `[--period <days>]` | maintainer | none | Report AI cost over a period by session kind, tool category and guard, with cost per merge and regressions against the period before |
| `josh defect:origin` | `<N>` | automation | network | List the merged pull requests that last changed what a defect issue names, as candidates for its origin line |
| `josh defect:report` | — | automation | network | Count defects by the origin pull request their issue declares, by change kind and by area |
| `josh delegate` | `<step> \| --list` | automation | none | Say whether a run step may go to a cheaper execution tier |
| `josh disposition` | `<path...>` | automation | none | Say whether a review finding reaches a runtime path (runtime) or is inert (non-runtime) |
| `josh doc:read` | `<file>` | automation | none | Read a whole document safely: print it, or point at the Read tool when over the Bash cap |
| `josh doc:section` | `<file> <heading>` | automation | none | Print one section of a markdown document, for a `file.md` → "Heading" reference |
| `josh edit:files` | `<plan-path \| ->` | automation | none | Apply several content-addressed edits from a plan in one call |
| `josh effect:audit` | `[--days <N>] [--draft <issue>]` | automation | network, files | List closed run-time-shortening issues with their expected effect, follow-up measurement and result |
| `josh epic` | `<title> <issue...> [--ordered]` | automation | network | Create an epic issue from its child issue numbers |
| `josh epic:audit` | `<epic>` | automation | network | Audit an epic's children against each other for contradictions |
| `josh epic:bundle` | `<issue> [--apply]` | automation | network | Say whether a newly filed issue belongs with ones already in the backlog |
| `josh epic:check` | `<epic>` | automation | network | Check an epic issue against the tracking requirements |
| `josh epic:next` | `<epic>... [--repo <owner/repo>] [--lanes]` | automation | network | List an epic's runnable children, bundled per repository |
| `josh eval` · `josh ev` · **kit only** | `[scenario...]` | maintainer | processes, network | Run the agent rule-compliance scenarios (real Claude sessions) |
| `josh fanout` | `<unit-files> <unit-files> [<unit-files> …]` | automation | none | Say whether proposed implementation units are file-disjoint, so they may run in parallel |
| `josh issue:ack` | `<issue>` | automation | network | Record that the run read a person's update to its issue, printing the update it acknowledges |
| `josh issue:already-done` | `<issue> --evidence-file <path>` | automation | network, files | Exit an issue whose work is already merged: post the evidence, apply already-done, release the hold |
| `josh issue:cite` | `<issue...> [--repo <owner/repo>]` | automation | network | Print the paste-ready number-link citation line for each issue, in one call |
| `josh issue:comment` | `<issue> --body <text> \| --body-file <path>` | automation | network | Post one comment to an issue from a file, so no shell expands the body |
| `josh issue:file` | `<title> --body-file <path> [--route <route>] [--label <name>] [--repo <owner/repo>] [--distinct <N,…>] [--found-during <N>] [--over-cap] [--no-auto-ok] [--release] [--blocks-finder]` | automation | network | File an Issue with every filing step: filing cap, fold, local checks (lint, Origin, auto-ok label), start condition and WIP cap, then the duplicate scout once none refuses, labels, then epic:bundle |
| `josh issue:fold` | `<title>... [--not-separable] [--json]` | automation | none | Before a second filing: say whether findings from this session fold into one issue |
| `josh issue:fold-existing` | `<assessment.json> [--json]` | automation | none | Assess whether a complete draft can join an unstarted issue |
| `josh issue:lint` | `<path>` | automation | files | Check an issue body file for the template's required headings |
| `josh issue:measured` | `<issue> --evidence-file <path> [--unmet]` | automation | network, files | Complete a measurement-only issue: post the result, label it measured, close it, release the hold |
| `josh issue:plan` | `<issue> --body-file <path> [--title <title>] [--planned] [--repo <owner/name>]` | automation | network | Record a plan: normalize the title, fill a blank body or comment, apply run:planned |
| `josh issue:priority` | `<issue>` | automation | network | Apply priority:high to an issue whose body reached the high floor after filing |
| `josh issue:read` | `<issue...>` | automation | network | Print each issue's title, body and every comment on it, in one call |
| `josh issue:release` | `<issue> [--wait]` | automation | network | Link an Issue to the repository's open release Issue as its blocker (or, with --wait, as waiting on it), filing one when none is open |
| `josh issue:scout` | `<title> [--body <summary> \| --body-file <path>]` | automation | network | Before filing: say whether an issue like this exists and which epic it belongs to |
| `josh issue:state` | `<issue...> [--repo <owner/repo>]` | automation | network | Print each issue's state and labels, in the spelling the documents compare against |
| `josh lane:adopt` · `josh lad` | `<issue> \| --all` | developer | files, git, processes, network | Give an open lane that lost its state record a record again, read from its process, work tree, unpushed commits, pull request and issue — its work untouched |
| `josh lane:await` | `<issue> [<issue>...] [--owner <pid>]` | automation | files, processes | Block until any of the named in-flight lane children completes; prints which one finished |
| `josh lane:breakdown` · `josh lbd` | `<issue>` | maintainer | none | Print a merged lane's net time by stage, longest first, the implementation split by its tool calls |
| `josh lane:close` | `<issue>` | automation | files, git | Close a lane, leaving no work tree, branch or directory behind |
| `josh lane:dispatch` | `<issue> <prompt>` | automation | processes | Start a lane’s child as a detached process that outlives this session |
| `josh lane:launch` | `<issue> [--stash <message>]` | automation | files, git, processes | Collapse a backlogrun lane-start event into one call: open the lane, pop and re-install on the first, dispatch the child |
| `josh lane:limit` · `josh lli` | `[<limit>] [--reset]` | developer | files | Change a live backlogrun’s lane limit without stopping it, or print the limit, lanes in use and free lanes |
| `josh lane:list` | — | automation | none | List the open lanes: which issue, which ports, and where each one is |
| `josh lane:net` · `josh lnt` | `<issue>` | maintainer | none | Print a lane's net minutes: its issue's first dispatch to its merge, less the waits its parks, outages, usage-limit stops and yields stood and the host's sleeps |
| `josh lane:open` | `<issue> [options]` | automation | files, git | Open a lane: a linked work tree with its own branch and its own port seed |
| `josh lane:output` | `<issue> [path]` | automation | files | Record, or read back, where the unit running a lane’s child writes |
| `josh lane:pause` · `josh lps` | `<issue> \| --all` | developer | processes | Suspend a running lane child’s process tree (SIGSTOP) in place, leaving its work tree, branch and issue untouched, and record the pause in the lane’s state and the run’s event stream |
| `josh lane:plan` | `<issue> <path>... [--probe]` | automation | files, network | Record the files a lane child plans to edit, and give the lane back when a running lane that planned earlier declares or plans one of them — naming the file and that issue |
| `josh lane:prune` | — | automation | files, git | Close every lane an interruption left without its work tree and every spent lane, then sweep unregistered leftovers under the lanes root |
| `josh lane:restart` · `josh lrs` | `<issue>` | developer | files, git, processes, network | Stop a running lane child, stash its uncommitted work and re-dispatch its issue in a fresh session — not counted as an outage or a failure |
| `josh lane:resume` · `josh lru` | `<issue> \| --all` | developer | processes | Let a paused lane child carry on from where it stopped (SIGCONT) |
| `josh lane:sample` · `josh lsm` | `[--every <seconds>]` | maintainer | files | Record the machine load (load average, swap, free memory, working lanes) to the lane ledger — a backlogrun samples itself, this is for a reading outside one |
| `josh lane:stats` · `josh lst` | `--period <days> [--limit <lane-limit>]` | maintainer | none | Print one table row of lane throughput, gate duration and machine load over a period, the per-stage durations of a lane under it, the wait after each ship stop reason under those, the duration and reuse count of each gate check, and each check's core claim against the cores it used |
| `josh lane:value` · `josh lva` | `<metric> --since <instant>` | maintainer | none | Print one lane measurement since an instant as a single number: cell (a lane:stats table cell, --table --row --column), lint-unmoved (median s of a lint:related that found nothing moved), metrics-stops (pre-detach metrics stops per lane), lint-core-wait (lint:related core-budget wait, min per lane), edit (median s of one Edit) |
| `josh lane:withdraw` · `josh lwd` | `<issue> --reason <text>` | developer | files, git, processes, network | Stop a running lane child, stash its uncommitted work and close the lane, leaving its issue open for the next run — booked withdrawn, not as an outage or a failure |
| `josh oracle:list` | — | automation | none | Print the decision oracles — commands that answer a rule question mechanically |
| `josh pkg:scout` | `<keywords> [--size <n>]` | automation | network | Rank package candidates by measured metrics so the Package-First tier decision is read, not judged |
| `josh plan:consumers` | `<identifier...>` | automation | none | List every existing reference to each identifier a plan adds or changes, by kind, and draft the plan's existing-consumers section |
| `josh prose:stale` | — | automation | none | List each removed declared or exported name, josh command, UPPER_CASE constant or .md heading that docs, prompts or comments still name |
| `josh read:files` | `<path> [<path> ...]` | automation | none | Read several files in one call so edit targets fold into one turn |
| `josh read:set` | `[<entry>] [--json]` | automation | none | Print what an entry point reads before it starts, and what that read costs |
| `josh repo:party` | `[<owner/repo>]` | automation | none | Say whether a repository is first-party or third-party by owner equality (computed, not judged) |
| `josh report:lint` | `[--child-summary] (reads stdin)` | automation | none | Check a two-layer work summary, or with --child-summary a lane child's summary, on stdin against its mechanical format rules |
| `josh report:template` | `summary\|done [<path>...]` | automation | files | Print the work summary or completion report skeleton in the session language: summary \| done |
| `josh retrospective` · `josh rtr` · **kit only** | — | maintainer | none | Aggregate a finished run's cost, review findings, observation ledger and events into one digest |
| `josh review:attest` | `<nonce> \| --check` | automation | files | Record, or verify, which checkout a /code-review actually read |
| `josh review:brief` | `[--round <1\|2>] \| --interaction \| --level-only [--staged] [--json]` | automation | files | Print the whole /code-review invocation: level, what the gate already proved, target (--level-only for the level alone) |
| `josh review:lint` | `[--round <1\|2>] (reads stdin)` | automation | none | Check a review's markdown on stdin against the review rubric's output format, round 1 or with --round 2 the verification pass |
| `josh review:round2` | `[--record <N>] [--json]` | automation | network | Say whether the second /code-review round is due, or may be skipped entirely |
| `josh review:submit` | `[--interaction] < findings \| [--interaction] --none` | automation | files | Write a ship reviewer's findings, read from stdin, where the ship reads them |
| `josh rule:list` | — | automation | none | Print the trigger-delivered rules — each one's source, firing call and silent turn — from the guard rows |
| `josh rule:value` · `josh ruv` | `[--fresh \| --refresh]` | developer | files | Print each delivered rule's unaided compliance — runs reached, kept rate, refusals |
| `josh run:add` | `<issue...> [--no-priority] [--retry]` | automation | network, files | Add issues to a live backlogrun, ahead of the queue unless --no-priority |
| `josh run:board` | `[--once \| --chat \| --every <minutes>]` | automation | files, network | Draw a live board of the running backlogrun, redrawn every second |
| `josh run:carry` | `<operation> [arguments...]` | automation | files | Carry one invocation’s budget across its own session cuts |
| `josh run:cut` | `[--resume] <issue> [--impl] [--handoff <path>]` | automation | files | Cut a lane child before the gate and resume a fresh process |
| `josh run:ending` | `<issue> --output <path> [--repo <owner/repo>]` | automation | network | Classify how a dispatched lane child ended (merged, cut, abandoned, unreadable) |
| `josh run:entry` | `<issue> [--to <command>]` | automation | git, network, files | Open a run in one call: claim the tree, read the budget, bundle the reads, decide the pre-implementation step |
| `josh run:event` | `--append <kind> <text> \| --from\|--follow <n> \| --watch [<n>] \| --last` | automation | files | Append to, read or watch the run’s append-only event stream (--append <kind> <text> \| --from\|--follow <n> \| --watch [<n>] \| --last) |
| `josh run:hold` | `[<issue> [--fullrun \| --halfrun-stop \| --human-review-stop \| --prrun-stop]] \| --adopt <issue>` | automation | files | Claim this working tree for a run, or say which run already holds it |
| `josh run:liveness` | `<issue> --output <path> [options]` | automation | processes | Say whether a delegated unit is still working, or stopped without reporting |
| `josh run:merge` | `<issue> [options]` | automation | git, network | Collapse a backlogrun merge event into one call: confirm the child, do the post-merge steps, offer the next child |
| `josh run:next` | `<issue>` | automation | network | Print the next step a fullrun takes, computed from the run’s state |
| `josh run:park` | `<issue> --body-file <path> \| <issue> --clear` | automation | files, network | Park a lane child for a decision, or clear the park |
| `josh run:pause` | `<issue> --for <prerequisite>` | automation | git, network, files | Set a run aside while its prerequisite lands first |
| `josh run:prep` | `<issue>` | automation | network | Bundle a run’s pre-edit reads: body, comments, state, dependency scope |
| `josh run:progress` | `[--once \| --wait] [--interval <minutes>] [--hours <hours>] [--repo <owner/repo>] [--output <path>] \| --mark \| --path` | automation | files | Report an unattended run’s progress once it has gone quiet for an interval |
| `josh run:release` | `[issue\|--force]` | automation | files | Release this working tree's run record |
| `josh run:report` | `[--handoff]` | automation | files, network | Generate the session-facing report for this invocation from the run’s event stream (merges, parks, cuts) with the release tail — the same text josh notify sends |
| `josh run:review` | `[--code-only] [--unpinned-ok "<reason>"] \| --join [--fixing] \| --pinned \| --push` | automation | processes, files, git, network | Start test:pinned and the gate in the background and write the /code-review brief to a file, printing its path, in one call so they overlap (--join to join them; it stops on an unpinned change) |
| `josh run:status` | `<issue> [--repo <owner/repo>]` | automation | network | Bundle a run’s read-only status: issue state, cost verdict, carry counters |
| `josh run:step` | `[<issue>]` | automation | network, files | Print the run’s next single action, computed from the event stream, carry record and issue state |
| `josh run:tail` | `[<issue> ...]` | automation | git, network | Close a run in one call: return to the default branch, commit the observation ledger, read the citations, decide the release scope |
| `josh run:tidy` | — | automation | git, network, files | Close merged lanes and drop stashes whose issues are all merged |
| `josh run:wake` | `[options]` | automation | processes, notifications | Wake the next session of a cut backlogrun from outside the conversation |
| `josh run:watcher:guard` | — | automation | none | Guard: exits non-zero when lane children are in-flight but the watcher has not pinged recently |
| `josh ship` | `"<title> #<N>" [<follow-up-N> ...] [--cite <N>] [--review [--unpinned-ok "<reason>"]] [--detach] [--body-file <path>] [--notify-message <text> \| --notify-message-file <path>] \| --log <N>` | automation | git, network | Ship a change in one call: gate, commit/push/PR, the CI-wait merge and the report bookkeeping, stopping at the first failed step |
| `josh ship:wait` | `<N>` | automation | files, processes | Wait on a detached ship through its gate and review round 1, so a stop there returns to this session (returned \| passed \| ended \| pending) |
| `josh split:assess` | `[--json]` | automation | none | Measure the branch change size (tests excluded) and answer the split assessment size question: split \| single |
| `josh stash:pop` | `<message>` | automation | git | Pop the stash matching this message, not whichever a shared stack has on top |
| `josh stash:push` | `<message>` | automation | git | Stash the working tree, untracked files included, leaving the observation ledger |
| `josh time` · `josh tm` · **kit only** | `[options]` | maintainer | none | Report where a run's wall clock went: model wait, tool execution, human wait |
| `josh time:density` · `josh tmd` · **kit only** | `[--lanes <n>] [--path <dir>]` | maintainer | none | Report tool calls per round trip across the recent lane sessions |
