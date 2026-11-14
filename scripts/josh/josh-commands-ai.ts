import { core_weights } from '#scripts/gate/core-weights'
import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'
import { BACKLOG_COMMANDS } from './josh-commands-backlog'
import { DOCUMENT_COMMANDS } from './josh-commands-document'
import { EPIC_COMMANDS } from './josh-commands-epic'
import { ISSUE_COMMANDS } from './josh-commands-issue'
import { REVIEW_COMMANDS } from './josh-commands-review'
import { RUN_COMMANDS } from './josh-commands-run'
import { SHIP_COMMANDS } from './josh-commands-ship'

const DIR = '--dir <path>'
const PATH_DIR = '--path <dir>'
const BARE = { arguments: '' }
// `lane:pause` and `lane:resume` take the same target.
const LANE_SIGNAL_EXAMPLES = [
	{ arguments: '4198' },
	{ arguments: '--all', note: 'every open lane' },
]

// One script answers `lane:open` / `lane:close` / `lane:list` / `lane:prune` / `lane:output` /
// `lane:dispatch` / `lane:await`, told apart by the verb below; `lane:launch` is the composite that
// opens, pops-and-installs on the first lane, and dispatches.
const LANE_SCRIPT = 'scripts/lane/lane-cli.ts'
// `JOSH_LANE_ROOT` and `JOSH_LANE_LIMIT` are personal, non-committed settings, so every lane command
// has to read `.env` to see them — without this the two are documented and unreachable.
const LANE_ARGUMENTS = { script: LANE_SCRIPT, tsx_arguments: OPTIONAL_ENV_FILE_FLAGS } as const
const ISSUE_WITH_OPTIONS = '<issue> [options]'
const ISSUE_OR_ALL = '<issue> | --all'
const MEASURE_ARGUMENTS = {
	script: 'scripts/lane/lane-measure-cli.ts',
	tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
} as const

const PAUSE_ARGUMENTS = {
	script: 'scripts/lane/lane-pause-cli.ts',
	tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
	category: 'AI tools',
	reference: [ISSUE_OR_ALL, 'developer', ['processes']],
} satisfies Partial<CommandEntry>

const AI_COMMANDS: Record<string, CommandEntry> = {
	...ISSUE_COMMANDS,
	'pkg:scout': {
		script: 'scripts/package/package-scout-cli.ts',
		description:
			'Rank package candidates by measured metrics so the Package-First tier decision is read, not judged',
		category: 'AI tools',
		reference: ['<keywords> [--size <n>] [--issue <n>]', 'automation', ['network']],
		usage: {
			examples: [{ arguments: '"date formatting" --size 5' }],
			flags: [
				{
					names: ['--size <n>'],
					description: 'how many candidates to fetch and rank (default 10).',
				},
				{
					names: ['--issue <n>'],
					description: 'the Issue a close pair reads for reuse (default: the held run).',
				},
			],
		},
	},
	'stash:push': {
		script: 'scripts/git/stash/stash-push-main.ts',
		description: 'Stash the working tree, untracked files included, leaving the observation ledger',
		category: 'AI tools',
		reference: ['<message>', 'automation', ['git']],
		usage: {
			examples: [{ arguments: '"backlogrun: josh latest before lanes"' }],
			flags: [
				{
					names: [DIR],
					description: 'stashes that work tree (`git -C <path>`); without it the current checkout.',
				},
			],
		},
	},
	'stash:pop': {
		script: 'scripts/git/stash/stash-pop-main.ts',
		description: 'Pop the stash matching this message, not whichever a shared stack has on top',
		category: 'AI tools',
		reference: ['<message>', 'automation', ['git']],
		usage: {
			examples: [
				{ arguments: '"backlogrun: parked #2028"' },
				{
					arguments: '"backlogrun: josh latest before lanes" --dir "$dir"',
					note: "into a lane's work tree",
				},
			],
			flags: [
				{
					names: [DIR],
					description:
						'applies the pop in that work tree (`git -C <path>`); without it the pop lands in the current checkout. The stack is shared, so it reads the same either way.',
				},
			],
		},
	},
	...EPIC_COMMANDS,
	...BACKLOG_COMMANDS,
	cost: {
		script: 'scripts/cost-runtime/cost-main.ts',
		description:
			'Say whether the next turn of a run crosses the context-cut threshold (--cut) or a given tokens-per-request figure (--over)',
		category: 'AI tools',
		reference: ['(--cut | --over <tokens-per-request>) [--path <dir>]', 'automation', ['none']],
		usage: {
			examples: [
				{
					arguments: '--cut',
					note: 'compare billed input per request with the context-cut threshold priced at the session model',
				},
				{ arguments: '--over <tokens>', note: 'compare with an explicit limit' },
				{ arguments: `--cut ${PATH_DIR}`, note: 'Anthropic project or current OpenAI worktree' },
			],
			flags: [
				{
					names: [PATH_DIR],
					description:
						'selects another Anthropic project; OpenAI accepts only linked checkouts of the current project.',
				},
			],
		},
	},
	'cost:audit': {
		script: 'tools/cost-audit/cost-audit-main.ts',
		description:
			'Report AI cost over a period by session kind, tool category and guard, with cost per merge and regressions against the period before',
		category: 'AI tools',
		reference: [
			'[--period <days> | --since <YYYY-MM-DD> --until <YYYY-MM-DD>] [--density]',
			'maintainer',
			['none'],
		],
		// Kit-only: it reads kit's own transcript store, like `josh retrospective`, which carries its
		// summary line.
		is_kit_only: true,
		// Reads transcripts and a `gh api` search (GET) only, so a consultation session can run it.
		is_read_only: true,
		usage: {
			examples: [
				{ arguments: '', note: 'the last 7 days against the 7 before' },
				{ arguments: '--period 30', note: 'the last 30 days against the 30 before' },
				{
					arguments: '--since 2026-10-27 --until 2026-11-10',
					note: 'those 15 UTC days against the 15 before',
				},
				{
					arguments: '--density',
					note: 'the lane-child calls per request alone, as the last line',
				},
			],
			flags: [
				{
					names: ['--period <days>'],
					description: 'the length of each period, a positive whole number of days (default 7).',
				},
				{
					names: ['--since <YYYY-MM-DD>', '--until <YYYY-MM-DD>'],
					description:
						'a fixed period instead, from the first UTC date through the second, both included; given together and never beside `--period`.',
				},
				{
					names: ['--density'],
					description:
						"print only the period's lane-child density (calls per request, two decimals), so a measurement Issue declares it; no lane-child request prints nothing and exits 1.",
				},
			],
		},
	},
	...DOCUMENT_COMMANDS,
	time: {
		script: 'tools/time/time-cli.ts',
		description: "Report where a run's wall clock went: model wait, tool execution, human wait",
		category: 'AI tools',
		reference: ['[options]', 'maintainer', ['none']],
		// Kit-only: it measures kit's own development runs and its report modules live under the
		// undistributed `tools/time/`, so it means nothing in a consumer project and is dropped from a
		// consumer's help. The runtime analysis hooks and guards rely on stays
		// distributed under `scripts/time-runtime/`.
		is_kit_only: true,
		usage: {
			examples: [
				{ arguments: '', note: 'the last run tree, wall clock and cost by role' },
				{ arguments: '--run', note: 'the same run-tree scope, named explicitly' },
				{ arguments: '--json', note: 'the same figures, machine-readable' },
				{ arguments: PATH_DIR, note: "read another project's transcripts from this checkout" },
				{
					arguments: '--split-at 2026-10-16T21:33:19Z',
					note: 'the same tree compared by role before and after a merge',
				},
			],
			flags: [
				{
					names: ['--run'],
					description:
						'(default) the whole run tree, wall clock led beside dollars. It is the only scope; any flag not listed here is a usage error (exit 1). History: `docs/maintainers/josh-commands-run-rationale.md` → "`josh cost` and `josh time` lost their report scopes".',
				},
				{
					names: [PATH_DIR],
					description:
						'aim the read at another project (absolute path); keeps the `cwd` behavior when absent.',
				},
				{ names: ['--json'], description: 'the run tree, machine-readable.' },
				{
					names: ['--split-at <ISO time>'],
					description:
						'add a before → after block by role (time share, cost share, req/session), each session on the side of its first request; an unparseable time is a usage error (exit 1).',
				},
			],
		},
	},
	// The tool-calls-per-round-trip density the batching guard is measured on, aggregated across the
	// recent lane sessions. Kit-only for the same reason `time` is: it reads
	// kit's own lane transcripts and means nothing in a consumer project.
	'time:density': {
		script: 'tools/time/time-density-cli.ts',
		description: 'Report tool calls per round trip across the recent lane sessions',
		category: 'AI tools',
		reference: ['[--lanes <n>] [--path <dir>]', 'maintainer', ['none']],
		is_kit_only: true,
		usage: {
			examples: [{ arguments: '' }, { arguments: '--lanes 5', note: 'the five most recent lanes' }],
			flags: [
				{
					names: ['--lanes <n>'],
					description: 'average over a different count of recent qualifying lanes (default 10).',
				},
				{
					names: [PATH_DIR],
					description:
						"read another project's lane transcripts, as `josh time` does. Run from a lane, it reads its main checkout's lanes.",
				},
			],
		},
	},
	retrospective: {
		script: 'tools/retrospective/retrospective-cli.ts',
		description:
			"Aggregate a finished run's cost, review findings, observation ledger and events into one digest",
		category: 'AI tools',
		reference: ['', 'maintainer', ['none']],
		core_weight: core_weights.CORE_WEIGHTS.retrospective,
		memory_mb: core_weights.MEMORY_MB.retrospective,
		// Kit-only: it reads kit's own development run — the transcript store, the review ledger and the
		// run event stream — so it means nothing in a consumer project and is dropped from a consumer's
		// help, through the same declaration `josh time` uses for the same reason.
		is_kit_only: true,
		usage: {
			examples: [{ arguments: '', note: 'the digest for the run this checkout carries' }],
		},
	},
	...REVIEW_COMMANDS,
	...RUN_COMMANDS,
	'repo:party': {
		script: 'scripts/discovery/repo-party-cli.ts',
		description:
			'Say whether a repository is first-party or third-party by owner equality (computed, not judged)',
		category: 'AI tools',
		reference: ['[<owner/repo>]', 'automation', ['none']],
		usage: {
			examples: [
				{ arguments: 'joshuafolkken/kit', note: '→ first-party (in the kit session)' },
				{ arguments: 'sveltejs/kit', note: '→ third-party' },
				{ arguments: '', note: "no argument: the session's own repository" },
			],
		},
	},
	'pin:verify': {
		script: 'scripts/discovery/pin-verify-cli.ts',
		description:
			'Check that a tag resolves to the commit a SHA pin names, printing a line a bypass reason cites',
		category: 'AI tools',
		reference: ['<owner/repo> <tag> <sha>', 'automation', ['none']],
		usage: {
			examples: [
				{
					arguments: 'actions/checkout v4.2.2 11bd71901bbe5b1630ceea73d27597364c9af683',
					note: '→ match / mismatch / unreadable',
				},
			],
		},
	},
	...SHIP_COMMANDS,
	'lane:open': {
		...LANE_ARGUMENTS,
		description: 'Open a lane: a linked work tree with its own branch and its own port seed',
		category: 'AI tools',
		reference: [ISSUE_WITH_OPTIONS, 'automation', ['files', 'git']],
		default_script_arguments: ['open'],
		usage: { examples: [{ arguments: '1490', note: 'prints the lane directory on stdout' }] },
	},
	'lane:close': {
		...LANE_ARGUMENTS,
		description: 'Close a lane, leaving no work tree, branch or directory behind',
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['files', 'git']],
		default_script_arguments: ['close'],
		usage: {
			examples: [{ arguments: '1490' }, { arguments: '--all' }],
			flags: [{ names: ['--all'], description: 'closes every lane.' }],
		},
	},
	'lane:list': {
		...LANE_ARGUMENTS,
		description: 'List the open lanes: which issue, which ports, and where each one is',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
		default_script_arguments: ['list'],
		usage: { examples: [BARE] },
	},
	'lane:prune': {
		...LANE_ARGUMENTS,
		description:
			'Close every lane an interruption left without its work tree and every spent lane, then sweep unregistered leftovers under the lanes root',
		category: 'AI tools',
		reference: ['', 'automation', ['files', 'git']],
		default_script_arguments: ['prune'],
		usage: { examples: [BARE] },
	},
	'lane:output': {
		...LANE_ARGUMENTS,
		description: 'Record, or read back, where the unit running a lane’s child writes',
		category: 'AI tools',
		reference: ['<issue> [path]', 'automation', ['files']],
		default_script_arguments: ['output'],
		usage: {
			examples: [
				{ arguments: '1713 /abs/path/to/agent-7.jsonl', note: 'record it; prints the path back' },
				{ arguments: '1713', note: 'read it; prints the path, or `none`' },
			],
		},
	},
	'lane:dispatch': {
		...LANE_ARGUMENTS,
		description: 'Start a lane’s child as a detached process that outlives this session',
		category: 'AI tools',
		reference: ['<issue> <prompt>', 'automation', ['processes']],
		default_script_arguments: ['dispatch'],
		usage: {
			examples: [
				{
					arguments: '1749',
					note: "prints the child's pid; a refusal is an empty capture and exit 1",
				},
			],
			flags: [
				{
					names: ['JOSH_{SCHEDULER,WORKER,REVIEWER}_MODEL'],
					description:
						'Claude Code role overrides; Anthropic defaults are respectively `claude-opus-5-5`, `claude-opus-5-5`, and `claude-opus-5-5`. Codex keeps its provider-specific model.',
				},
				{
					names: ['JOSH_{SCHEDULER,WORKER,REVIEWER}_EFFORT'],
					description:
						'role effort overrides for either provider; defaults are `medium`, `medium`, and `medium`.',
				},
				{
					names: ['JOSH_REVIEWER_VERIFICATION_{MODEL,EFFORT}'],
					description:
						'review round 2 and later (the verification pass); defaults are `claude-sonnet-5-5` / `high` on Anthropic and `high` on OpenAI, falling back to `JOSH_REVIEWER_*`.',
				},
			],
		},
	},
	'lane:await': {
		...LANE_ARGUMENTS,
		description:
			'Block until any of the named in-flight lane children completes; prints which one finished',
		category: 'AI tools',
		reference: ['<issue> [<issue>...] [--owner <pid>]', 'automation', ['files', 'processes']],
		default_script_arguments: ['await'],
		usage: {
			examples: [
				{
					arguments: '1749 1750',
					note: 'reclaim a resumed conversation’s carry record, then block until either lane completes',
				},
			],
		},
	},
	'lane:launch': {
		script: 'scripts/lane/lane-launch-main.ts',
		description:
			'Collapse a backlogrun lane-start event into one call: open the lane, pop and re-install on the first, dispatch the child',
		category: 'AI tools',
		reference: ['<issue> [--stash <message>]', 'automation', ['files', 'git', 'processes']],
		usage: {
			examples: [
				{ arguments: '1749', note: 'every lane after the first' },
				{
					arguments: '1749 --stash "backlogrun: josh latest before lanes"',
					note: 'the first lane only',
				},
			],
		},
	},
	// `.env` is read for `JOSH_LANE_ROOT`, as every lane command reads it, so the lane is found.
	'lane:restart': {
		script: 'scripts/lane/lane-restart-cli.ts',
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description:
			'Stop a running lane child, stash its uncommitted work and re-dispatch its issue in a fresh session — not counted as an outage or a failure',
		category: 'AI tools',
		reference: ['<issue>', 'developer', ['files', 'git', 'processes', 'network']],
		usage: {
			examples: [{ arguments: '3769', note: "prints the fresh child's pid" }],
		},
	},
	// `.env` is read for `JOSH_LANE_ROOT`, as every lane command reads it, so the lane is found.
	'lane:withdraw': {
		script: 'scripts/lane/lane-withdraw-cli.ts',
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description:
			'Stop a running lane child, stash its uncommitted work and close the lane, leaving its issue open for the next run — booked withdrawn, not as an outage or a failure',
		category: 'AI tools',
		reference: ['<issue> --reason <text>', 'developer', ['files', 'git', 'processes', 'network']],
		usage: {
			examples: [{ arguments: '3769 --reason "folded into a broader issue"' }],
		},
	},
	'lane:resolve': {
		script: 'scripts/lane/lane-resolve-cli.ts',
		description:
			"Merge the default branch into a lane's branch and print one verdict — resolved, conflict <paths>, or step-back 2 (overlapping hunks, merge aborted) / 3 (a resolution already recorded on the issue); --record posts that resolution comment once the lane is pushed",
		category: 'AI tools',
		reference: ['<issue> [--record [<path>...]]', 'developer', ['git', 'network', 'files']],
		usage: {
			examples: [
				{ arguments: '3769', note: 'prints `conflict docs/a.md` on a hand-resolvable conflict' },
				{
					arguments: '3769 --record docs/a.md',
					note: 'posts the `## Lane conflict resolved` comment once the lane is pushed',
				},
			],
		},
	},
	// `.env` is read for the Telegram settings the yield's hold release reaches (`run-hold-cli.ts`).
	'lane:plan': {
		script: 'scripts/lane/lane-plan-cli.ts',
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description:
			"Record a lane child's planned files; yield its lane, naming file and holder, when an earlier-planned running lane declares or plans one; `--size-approval` bounds lines/files",
		category: 'AI tools',
		reference: [
			'<issue> <path>... [--probe] [--single] [--estimate <json-file>] [--size-approval <json-file>] [--imports <path>...]',
			'automation',
			['files', 'network'],
		],
		usage: {
			examples: [{ arguments: '4864 scripts/lane/lane-plan.ts scripts/backlog/backlog-next.ts' }],
		},
	},
	// `.env` is read for `JOSH_LANE_ROOT`, as every lane command reads it, so `--all` finds the lanes.
	'lane:pause': {
		...PAUSE_ARGUMENTS,
		description:
			'Suspend a running lane child’s process tree (SIGSTOP) in place, leaving its work tree, branch and issue untouched, and record the pause in the lane’s state and the run’s event stream',
		default_script_arguments: ['pause'],
		usage: { examples: LANE_SIGNAL_EXAMPLES },
	},
	'lane:resume': {
		...PAUSE_ARGUMENTS,
		description: 'Let a paused lane child carry on from where it stopped (SIGCONT)',
		default_script_arguments: ['resume'],
		usage: { examples: LANE_SIGNAL_EXAMPLES },
	},
	// `.env` is read for `JOSH_LANE_ROOT`, as every lane command reads it, so `--all` finds the lanes.
	'lane:adopt': {
		script: 'scripts/lane/lane-adopt-cli.ts',
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description:
			'Give an open lane that lost its state record a record again, read from its process, work tree, unpushed commits, pull request and issue — its work untouched',
		category: 'AI tools',
		reference: [ISSUE_OR_ALL, 'developer', ['files', 'git', 'processes', 'network']],
		usage: {
			examples: [
				{ arguments: '4744' },
				{ arguments: '--all', note: 'every open lane with no record' },
			],
		},
	},
	// A live run's lane limit: `.env` is read so the bare form reports the
	// `JOSH_LANE_LIMIT` a person set there when no override stands.
	'lane:limit': {
		script: 'scripts/lane/lane-limit-cli.ts',
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description:
			'Change a live backlogrun’s lane limit without stopping it, or print the limit, lanes in use and free lanes',
		category: 'AI tools',
		reference: ['[<limit>] [--reset]', 'developer', ['files']],
		usage: {
			examples: [
				{ arguments: '8', note: "raise or lower the live run's limit to 8" },
				{ arguments: '', note: 'print the limit, the lanes in use and the free lanes' },
				{ arguments: '--reset', note: 'clear the override; the run’s start limit applies again' },
			],
		},
	},
	// The lane-limit measurement: `.env` is read so `lane:stats` labels the row
	// with the `JOSH_LANE_LIMIT` a person set there.
	'lane:sample': {
		...MEASURE_ARGUMENTS,
		description:
			'Record the machine load (load average, swap, free memory, working lanes) to the lane ledger — a backlogrun samples itself, this is for a reading outside one',
		category: 'AI tools',
		reference: ['[--every <seconds>]', 'maintainer', ['files']],
		default_script_arguments: ['sample'],
		usage: { examples: [{ arguments: '', note: 'one machine-load reading' }] },
	},
	'lane:stats': {
		...MEASURE_ARGUMENTS,
		description:
			'Print period lane throughput, stage, stop (by failed CI check, longest first), check, runnable-to-dispatch wait and machine-load statistics; --sinks shows stage totals, --over lane chains, --why cause groups above a net-minute threshold, and --pairs scoped pair runs',
		category: 'AI tools',
		reference: [
			'(--period <days> | --since <instant>) [--limit <lane-limit> | --sinks [<minutes>] | --over <minutes> | --why <minutes> | --pairs]',
			'maintainer',
			['none'],
		],
		default_script_arguments: ['stats'],
		usage: {
			examples: [
				{ arguments: '--period 7', note: "a 7-day period's stage medians and maxima" },
				{ arguments: '--period 1 --sinks', note: 'stage totals of the lanes over 30 net min' },
				{ arguments: '--period 1 --over 40', note: 'ledger chains of lanes over 40 net min' },
				{ arguments: '--period 1 --why 40', note: 'cause groups of lanes over 40 net min' },
				{ arguments: '--period 7 --pairs', note: "a 7-day period's scoped pair runs" },
				{ arguments: '--since 2026-11-10T01:00Z --why 40', note: 'cause groups since an instant' },
			],
		},
	},
	// One lane measurement as one number on the last line, for an Issue's measurement declaration
	// (joshuafolkken/kit#4630).
	'lane:value': {
		...MEASURE_ARGUMENTS,
		description:
			'Print one lane measurement since an instant as a single number: cell (a lane:stats table cell, --table --row --where --column --item --zero), lint-unmoved (median s of a lint:related that found nothing moved), metrics-stops (pre-detach metrics stops per lane), lint-core-wait (lint:related core-budget wait, min per lane), edit (median s of one Edit)',
		category: 'AI tools',
		reference: ['<metric> --since <instant>', 'maintainer', ['none']],
		default_script_arguments: ['value'],
		usage: {
			examples: [
				{
					arguments: 'edit --since 2026-10-23T03:29Z',
					note: 'the median Edit time since an instant',
				},
				{
					arguments:
						'cell --table "test:related scope" --row related --column "median (s)" --since 2026-10-23T03:29Z',
					note: 'one lane:stats table cell since an instant',
				},
			],
		},
	},
	'lane:net': {
		...MEASURE_ARGUMENTS,
		description:
			"Print a lane's net minutes: its issue's first dispatch to its merge, less the waits its parks, outages, usage-limit stops and yields stood, the host's sleeps and the ship's followup",
		category: 'AI tools',
		reference: ['<issue>', 'maintainer', ['none']],
		default_script_arguments: ['net'],
		usage: {
			examples: [
				{
					arguments: '4695',
					note: 'the net minutes a causing-lane line declares',
				},
			],
		},
	},
	'lane:breakdown': {
		script: 'scripts/lane/lane-breakdown-cli.ts',
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description:
			"Print a merged lane's net time by stage, longest first, the implementation split by its tool calls",
		category: 'AI tools',
		reference: ['<issue> [--timeline]', 'maintainer', ['none']],
		usage: {
			flags: [
				{
					names: ['--timeline'],
					description:
						'prints the lane in time order instead, one line a stage, wait or event, the stage lines adding up to the net time.',
				},
			],
			examples: [
				{
					arguments: '4970',
					note: 'the breakdown the overrun investigation comments on the lane',
				},
				{ arguments: '4970 --timeline', note: 'when each stage ran and where the lane waited' },
			],
		},
	},
	'lane:why': {
		script: 'scripts/lane/lane-why-cli.ts',
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description:
			"Print a merged lane's stages over budget, one row each, beside the records that say why",
		category: 'AI tools',
		reference: ['<issue>', 'maintainer', ['processes', 'network']],
		usage: {
			examples: [
				{
					arguments: '6050',
					note: 'the cause table an overrun investigation joins by hand',
				},
			],
		},
	},
	'run:watcher:guard': {
		script: 'scripts/run/run-watcher-guard-cli.ts',
		description:
			'Guard: exits non-zero when lane children are in-flight but the watcher has not pinged recently',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
		usage: { examples: [BARE] },
	},
	'split:recover': {
		script: 'scripts/split/split-child-recover-cli.ts',
		description:
			'Recover split-child evidence after verifying an existing child URL, split route and parent',
		category: 'AI tools',
		reference: ['<origin> <child-issue-url>', 'automation', ['network', 'files']],
		usage: { examples: [{ arguments: '6212 https://github.com/joshuafolkken/kit/issues/6326' }] },
	},
	'split:assess': {
		script: 'scripts/split/split-assess-cli.ts',
		description:
			'Measure the branch change size (tests excluded) and answer the split assessment size question: split | single',
		category: 'AI tools',
		reference: ['[--json]', 'automation', ['none']],
		usage: {
			examples: [
				{ arguments: '', note: '→ single' },
				{ arguments: '--json', note: 'the verdict and the reason, machine-readable' },
			],
		},
	},
	'oracle:list': {
		script: 'scripts/rules/oracle-list-cli.ts',
		description: 'Print the decision oracles — commands that answer a rule question mechanically',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
		usage: { examples: [{ arguments: '' }] },
	},
	eval: {
		script: 'tools/eval/eval-run.ts',
		description: 'Run the agent rule-compliance scenarios (real Claude sessions)',
		category: 'AI tools',
		reference: ['[scenario...]', 'maintainer', ['processes', 'network']],
		// Kit-only: it replays kit's own distributed rules against real Claude sessions, so it means
		// nothing in a consumer project and is dropped from a consumer's help.
		is_kit_only: true,
		usage: {
			examples: [
				{ arguments: '', note: 'every scenario' },
				{ arguments: 'consult-not-execute', note: 'one scenario by name' },
			],
			flags: [
				{ names: ['JOSH_EVAL_MODEL'], description: 'the model to run against (default `sonnet`).' },
				{
					names: ['JOSH_EVAL_CONCURRENCY'],
					description:
						'how many sessions run at once (default `5`); a non-positive-integer value is refused.',
				},
			],
		},
	},
}

export { AI_COMMANDS }
