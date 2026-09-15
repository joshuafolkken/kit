import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

// One script answers both `run:hold` and `run:release`; the flag below is what tells them apart.
const RUN_HOLD_SCRIPT = 'scripts/run/run-hold-cli.ts'
// One script answers all four `lane:*` commands; the verb below is what tells them apart.
const LANE_SCRIPT = 'scripts/lane/lane-cli.ts'
// `JOSH_LANE_ROOT` and `JOSH_LANE_LIMIT` are personal, non-committed settings, so every lane
// command has to read `.env` to see them — without this the two are documented and unreachable.
const LANE_ARGUMENTS = { script: LANE_SCRIPT, tsx_arguments: OPTIONAL_ENV_FILE_FLAGS } as const

/* eslint-disable @typescript-eslint/naming-convention */
const AI_COMMANDS: Record<string, CommandEntry> = {
	'issue:read': {
		script: 'scripts/issue/issue-read-cli.ts',
		description: "Print each issue's title, body and every comment on it, in one call",
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
	'backlog:plan': {
		script: 'scripts/backlog/backlog-plan-cli.ts',
		description:
			'Print the whole backlog as a plan: ready now, waiting on what, waiting on a person, out of scope',
		category: 'AI tools',
	},
	'backlog:budget': {
		script: 'scripts/backlog/backlog-budget-cli.ts',
		description: 'Say whether a backlogrun may start more work, keep watching, or finish',
		category: 'AI tools',
	},
	cost: {
		script: 'scripts/cost-runtime/cost-cli.ts',
		description: "Report a run's token and credit cost from Claude Code's session transcripts",
		category: 'AI tools',
	},
	'doc:section': {
		script: 'scripts/document/document-section-cli.ts',
		description: 'Print one section of a markdown document, for a `file.md` → "Heading" reference',
		category: 'AI tools',
	},
	'read:set': {
		script: 'scripts/document/read-set-cli.ts',
		description: 'Print what an entry point reads before it starts, and what that read costs',
		category: 'AI tools',
	},
	time: {
		script: 'scripts/time/time-cli.ts',
		description: "Report where a run's wall clock went: model wait, tool execution, human wait",
		category: 'AI tools',
		// Kit-only: it measures kit's own development runs and its report modules live under the
		// undistributed `scripts/time/`, so it means nothing in a consumer project and is dropped from a
		// consumer's help (joshuafolkken/kit#1997). The runtime analysis hooks and guards rely on stays
		// distributed under `scripts/time-runtime/`.
		is_kit_only: true,
	},
	'review:brief': {
		script: 'scripts/review/review-brief-cli.ts',
		description:
			'Print the whole /code-review invocation: level, what the gate already proved, target (--level-only for the level alone)',
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
	'run:carry': {
		script: 'scripts/run/run-carry-cli.ts',
		description: 'Carry one invocation’s budget across its own session cuts',
		category: 'AI tools',
	},
	'run:wake': {
		script: 'scripts/run/run-wake-cli.ts',
		// `.env` rather than the ambient environment:
		// the failure warning needs the Telegram credentials, the same
		// reasons `notify` and `followup` carry these flags.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description:
			'Continue a cut backlogrun by waking the next session from outside the conversation',
		category: 'AI tools',
	},
	'run:cut': {
		script: 'scripts/run/run-cut-cli.ts',
		description:
			'Cut a lane child before the gate and resume a fresh process from the persisted state',
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
	'run:prep': {
		script: 'scripts/run/run-prep-cli.ts',
		description:
			'Bundle the reads a run makes before its first edit: issue body and comments, state, dependency-update scope',
		category: 'AI tools',
	},
	'run:merge': {
		script: 'scripts/run/run-merge-cli.ts',
		description:
			'Collapse a backlogrun merge event into one call: confirm the child, do the post-merge steps, offer the next child',
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
	'lane:output': {
		...LANE_ARGUMENTS,
		description: 'Record, or read back, where the unit running a lane’s child writes',
		category: 'AI tools',
		default_script_arguments: ['output'],
	},
	'lane:dispatch': {
		...LANE_ARGUMENTS,
		description: 'Start a lane’s child as a detached process that outlives this session',
		category: 'AI tools',
		default_script_arguments: ['dispatch'],
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
		// Kit-only: it replays kit's own distributed rules against real Claude sessions, so it means
		// nothing in a consumer project and is dropped from a consumer's help (joshuafolkken/kit#1988).
		is_kit_only: true,
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { AI_COMMANDS }
