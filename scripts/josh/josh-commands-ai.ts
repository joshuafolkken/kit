import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

// One script answers both `run:hold` and `run:release`; the flag below is what tells them apart.
const RUN_HOLD_SCRIPT = 'scripts/run/run-hold-cli.ts'
// One script answers all four `lane:*` commands; the verb below is what tells them apart.
const LANE_SCRIPT = 'scripts/lane/lane-cli.ts'
// `JOSH_LANE_ROOT` and `JOSH_LANE_SEED_BASE` are personal, non-committed settings, so every lane
// command has to read `.env` to see them — without this the two are documented and unreachable.
const LANE_ARGUMENTS = { script: LANE_SCRIPT, tsx_arguments: OPTIONAL_ENV_FILE_FLAGS } as const

/* eslint-disable @typescript-eslint/naming-convention */
const AI_COMMANDS: Record<string, CommandEntry> = {
	prep: {
		script: 'scripts-ai/prep.ts',
		description: 'Pre-implementation preparation',
		category: 'AI tools',
	},
	issue: {
		script: 'scripts-ai/issue-prep.ts',
		description: 'Fetch GitHub issue details',
		category: 'AI tools',
	},
	'issue:state': {
		script: 'scripts/issue/issue-state-cli.ts',
		description:
			"Print each issue's state and labels, in the spelling the documents compare against",
		category: 'AI tools',
	},
	'issue:scout': {
		script: 'scripts/issue/issue-scout-cli.ts',
		description:
			'Before filing: say whether an issue like this exists and which epic it belongs to',
		category: 'AI tools',
	},
	epic: {
		script: 'scripts-ai/epic.ts',
		description: 'Create an epic issue from its child issue numbers',
		category: 'AI tools',
	},
	'epic:next': {
		script: 'scripts/epic/epic-next.ts',
		description: "List an epic's runnable children, bundled per repository",
		category: 'AI tools',
	},
	'epic:plan': {
		script: 'scripts/epic/epic-plan-cli.ts',
		description: 'Print every child of an epic as JSON, for one batch of decisions',
		category: 'AI tools',
	},
	'epic:bundle': {
		script: 'scripts/epic/epic-bundle-cli.ts',
		description: 'Say whether a newly filed issue belongs with ones already in the backlog',
		category: 'AI tools',
	},
	'epic:audit': {
		script: 'scripts/epic/epic-audit-cli.ts',
		description: "Audit an epic's children against each other for contradictions",
		category: 'AI tools',
	},
	'epic:check': {
		script: 'scripts-ai/epic-check.ts',
		description: 'Check an epic issue against the tracking requirements',
		category: 'AI tools',
	},
	'auto-ok:next': {
		script: 'scripts/auto-ok/auto-ok-cli.ts',
		description: 'Print the next opted-in issue an unattended run may pick up outside an epic',
		category: 'AI tools',
	},
	'backlog:next': {
		script: 'scripts/backlog/backlog-next.ts',
		description:
			'Order the whole opted-in backlog: auto-ok issues and the children of auto-ok epics',
		category: 'AI tools',
	},
	cost: {
		script: 'scripts/cost/cost-cli.ts',
		description: "Report a run's token and credit cost from Claude Code's session transcripts",
		category: 'AI tools',
	},
	time: {
		script: 'scripts/time/time-cli.ts',
		description: "Report where a run's wall clock went: model wait, tool execution, human wait",
		category: 'AI tools',
	},
	layers: {
		script: 'scripts/layers/layers-cli.ts',
		description: 'List the checks that run in more than one verification layer',
		category: 'AI tools',
	},
	bench: {
		script: 'scripts/bench/bench-cli.ts',
		description: 'Measure what a verification command costs with its cache cold and warm',
		category: 'AI tools',
	},
	'review:level': {
		script: 'scripts/review/review-level-cli.ts',
		description: 'Print the /code-review level this change is reviewed at',
		category: 'AI tools',
	},
	'review:brief': {
		script: 'scripts/review/review-brief-cli.ts',
		description:
			'Print the whole /code-review invocation: level, what the gate already proved, target',
		category: 'AI tools',
	},
	'review:attest': {
		script: 'scripts/review/review-attest-cli.ts',
		description: 'Record, or verify, which checkout a /code-review actually read',
		category: 'AI tools',
	},
	'review:round2': {
		script: 'scripts/review/review-round2-cli.ts',
		description: 'Say whether the second /code-review round is due, or may be skipped entirely',
		category: 'AI tools',
	},
	delegate: {
		script: 'scripts/delegation/delegation-cli.ts',
		description: 'Say whether a run step may go to a cheaper execution tier',
		category: 'AI tools',
	},
	'run:hold': {
		script: RUN_HOLD_SCRIPT,
		description: 'Claim this working tree for a run, or say which run already holds it',
		category: 'AI tools',
	},
	'run:release': {
		script: RUN_HOLD_SCRIPT,
		description: "Release this working tree's run record",
		category: 'AI tools',
		default_script_arguments: ['--release'],
	},
	'run:preflight': {
		script: 'scripts/run/run-preflight-cli.ts',
		description: 'Say what an interrupted run left in this tree, and what to do about it',
		category: 'AI tools',
	},
	'run:liveness': {
		script: 'scripts/run/run-liveness-cli.ts',
		description: 'Say whether a delegated unit is still working, or stopped without reporting',
		category: 'AI tools',
	},
	'run:progress': {
		script: 'scripts/run/run-progress-cli.ts',
		description: 'Report an unattended run’s progress once it has gone quiet for an interval',
		category: 'AI tools',
	},
	'lane:open': {
		...LANE_ARGUMENTS,
		description: 'Open a lane: a linked work tree with its own branch and its own port seed',
		category: 'AI tools',
		default_script_arguments: ['open'],
	},
	'lane:close': {
		...LANE_ARGUMENTS,
		description: 'Close a lane, leaving no work tree, branch or directory behind',
		category: 'AI tools',
		default_script_arguments: ['close'],
	},
	'lane:list': {
		...LANE_ARGUMENTS,
		description: 'List the open lanes: which issue, which ports, and where each one is',
		category: 'AI tools',
		default_script_arguments: ['list'],
	},
	'lane:prune': {
		...LANE_ARGUMENTS,
		description: 'Close every lane an interruption left without its work tree',
		category: 'AI tools',
		default_script_arguments: ['prune'],
	},
	'investigation:guard': {
		script: 'scripts/delegation/investigation-guard.ts',
		description:
			'Claude Code hook: refuse a read once the unedited-read threshold is reached again (reads the tool call on stdin)',
		category: 'AI tools',
		// **No `tsx_arguments`, for the reason `batch:guard` declares none** (joshuafolkken/kit#1342):
		// declaring any disqualifies a command from in-process dispatch, and this one runs in front of
		// every read. The script calls `process.loadEnvFile` itself instead, through
		// `hook-decision.ts`.
	},
	'rule:value': {
		script: 'scripts/rules/rule-value-cli.ts',
		description:
			"What each trigger-delivered rule's carried text earns unaided, read off this checkout's recorded sessions",
		category: 'AI tools',
	},
	'rule:guard': {
		script: 'scripts/rules/rule-guard.ts',
		description:
			'Claude Code hook: deliver a trigger-delivered rule at the call that binds it (reads the tool call on stdin)',
		category: 'AI tools',
		// **No `tsx_arguments`, for the reason the other two guards declare none**
		// (joshuafolkken/kit#1342): declaring any disqualifies a command from in-process dispatch, and
		// this one runs in front of every shell call.
	},
	eval: {
		script: 'scripts/eval/eval-run.ts',
		description: 'Run the agent rule-compliance scenarios (real Claude sessions)',
		category: 'AI tools',
	},
	'eval:scope': {
		script: 'scripts/eval/eval-trigger-cli.ts',
		description: 'Say whether this change has to be measured by josh eval',
		category: 'AI tools',
		// The opt-in switch is a per-machine preference, so `.env` is where a person keeps it
		// (joshuafolkken/kit#1235). Without this flag `JOSH_EVAL=on` written there is ignored and the
		// command answers `skip` with no complaint — the silent half of a switch whose safe state is
		// off. The optional form, because this file need not exist; an environment variable set
		// inline still wins over it.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { AI_COMMANDS }
