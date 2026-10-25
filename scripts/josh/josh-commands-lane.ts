import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

const BARE = { arguments: '' }
// `lane:pause` and `lane:resume` take the same target.
const LANE_SIGNAL_EXAMPLES = [
	{ arguments: '4198' },
	{ arguments: '--all', note: 'every open lane' },
]

// The `lane:*` command registry, split out of `josh-commands-ai.ts` so that file stays under its line
// limit. One script answers `lane:open` / `lane:close` / `lane:list` /
// `lane:prune` / `lane:output` / `lane:dispatch` / `lane:await`, told apart by the verb below;
// `lane:launch` is the composite that opens, pops-and-installs on the first lane, and dispatches.
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

/* eslint-disable @typescript-eslint/naming-convention */
const LANE_COMMANDS: Record<string, CommandEntry> = {
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
						'role effort overrides for either provider; defaults are `medium`, `medium`, and `high`.',
				},
				{
					names: ['JOSH_REVIEWER_VERIFICATION_{MODEL,EFFORT}'],
					description:
						'review round 2 and later (the verification pass); Anthropic defaults are `claude-sonnet-5-5` / `high`, falling back to `JOSH_REVIEWER_*`.',
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
				{ arguments: '1749 1750', note: 'block until either lane completes' },
				{
					arguments: '1749 1750 --owner "$PPID"',
					note: 'reclaim the carry record for a resumed conversation first',
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
	'lane:plan': {
		script: 'scripts/lane/lane-plan-cli.ts',
		description:
			'Record the files a lane child plans to edit, and wait before implementing while a running lane that planned earlier declares or plans one of them — naming the file and that issue',
		category: 'AI tools',
		reference: ['<issue> <path>...', 'automation', ['files', 'network']],
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
				{ arguments: '--reset', note: 'clear the override; JOSH_LANE_LIMIT applies again' },
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
			'Print one table row of lane throughput, gate duration and machine load over a period, the per-stage durations of a lane under it, the wait after each ship stop reason under those, and the duration and reuse count of each gate check last',
		category: 'AI tools',
		reference: ['--period <days> [--limit <lane-limit>]', 'maintainer', ['none']],
		default_script_arguments: ['stats'],
		usage: {
			examples: [{ arguments: '--period 7', note: "a 7-day period's stage medians and maxima" }],
		},
	},
	// One lane measurement as one number on the last line, for an Issue's measurement declaration
	// (joshuafolkken/kit#4630).
	'lane:value': {
		...MEASURE_ARGUMENTS,
		description:
			'Print one lane measurement since an instant as a single number: lint-unmoved (median s of a lint:related that found nothing moved), metrics-stops (pre-detach metrics stops per lane), lint-core-wait (lint:related core-budget wait, min per lane), edit (median s of one Edit)',
		category: 'AI tools',
		reference: ['<metric> --since <instant>', 'maintainer', ['none']],
		default_script_arguments: ['value'],
		usage: {
			examples: [
				{
					arguments: 'edit --since 2026-10-23T03:29Z',
					note: 'the median Edit time since an instant',
				},
			],
		},
	},
	'lane:net': {
		...MEASURE_ARGUMENTS,
		description:
			"Print a lane's net minutes: its issue's first dispatch to its merge, less the waits its parks, outages and usage-limit stops stood",
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
	// The under-share overrun causes summed per mechanism across lanes (joshuafolkken/kit#4886).
	'overrun:mechanisms': {
		script: 'scripts/lane/lane-overrun-mechanisms-cli.ts',
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description:
			'Sum the unfiled overrun causes per mechanism key over a period, and print each key’s minutes per merge, its share of the median lane time and whether it is to be filed',
		category: 'AI tools',
		reference: ['[--period <days>] [--since <instant>]', 'maintainer', ['none']],
		usage: {
			examples: [{ arguments: '--period 3', note: "the last 3 days' mechanisms" }],
		},
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { LANE_COMMANDS }
