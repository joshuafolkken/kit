import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

// One script answers both `run:hold` and `run:release`; the flag below is what tells them apart.
const RUN_HOLD_SCRIPT = 'scripts/run/run-hold-cli.ts'
// One script answers all four `lane:*` commands; the verb below is what tells them apart.
const LANE_SCRIPT = 'scripts/lane/lane-cli.ts'
// `JOSH_LANE_ROOT` and `JOSH_LANE_LIMIT` are personal, non-committed settings, so every lane
// command has to read `.env` to see them — without this the two are documented and unreachable.
const LANE_ARGUMENTS = { script: LANE_SCRIPT, tsx_arguments: OPTIONAL_ENV_FILE_FLAGS } as const
const ISSUE_WITH_OPTIONS = '<issue> [options]'

/* eslint-disable @typescript-eslint/naming-convention */
const AI_COMMANDS: Record<string, CommandEntry> = {
	'issue:read': {
		script: 'scripts/issue/issue-read-cli.ts',
		description: "Print each issue's title, body and every comment on it, in one call",
		category: 'AI tools',
		reference: ['<issue...>', 'automation', ['network']],
	},
	'issue:state': {
		script: 'scripts/issue/issue-state-cli.ts',
		description:
			"Print each issue's state and labels, in the spelling the documents compare against",
		category: 'AI tools',
		reference: ['<issue...> [--repo <owner/repo>]', 'automation', ['network']],
	},
	'issue:scout': {
		script: 'scripts/issue/issue-scout-cli.ts',
		description:
			'Before filing: say whether an issue like this exists and which epic it belongs to',
		category: 'AI tools',
		reference: ['<title> [--body <summary>]', 'automation', ['network']],
	},
	'stash:pop': {
		script: 'scripts/git/stash-pop-cli.ts',
		description: 'Pop the stash matching this message, not whichever a shared stack has on top',
		category: 'AI tools',
		reference: ['<message>', 'automation', ['git']],
	},
	epic: {
		script: 'scripts-ai/epic.ts',
		description: 'Create an epic issue from its child issue numbers',
		category: 'AI tools',
		reference: ['<title> <issue...> [--ordered]', 'automation', ['network']],
	},
	'epic:next': {
		script: 'scripts/epic/epic-next.ts',
		description: "List an epic's runnable children, bundled per repository",
		category: 'AI tools',
		reference: ['<epic>', 'automation', ['network']],
	},
	'epic:bundle': {
		script: 'scripts/epic/epic-bundle-cli.ts',
		description: 'Say whether a newly filed issue belongs with ones already in the backlog',
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['network']],
	},
	'epic:audit': {
		script: 'scripts/epic/epic-audit-cli.ts',
		description: "Audit an epic's children against each other for contradictions",
		category: 'AI tools',
		reference: ['<epic>', 'automation', ['network']],
	},
	'epic:check': {
		script: 'scripts-ai/epic-check.ts',
		description: 'Check an epic issue against the tracking requirements',
		category: 'AI tools',
		reference: ['<epic>', 'automation', ['network']],
	},
	'auto-ok:next': {
		script: 'scripts/auto-ok/auto-ok-cli.ts',
		description: 'Print the next opted-in issue an unattended run may pick up outside an epic',
		category: 'AI tools',
		reference: ['[--exclude <n>[,<n>...]] [--label <name>]', 'automation', ['network']],
	},
	'backlog:next': {
		script: 'scripts/backlog/backlog-next.ts',
		description:
			'Order the whole opted-in backlog: auto-ok issues and the children of auto-ok epics',
		category: 'AI tools',
		reference: ['[--exclude <n>[,<n>...]] [--repo <owner/repo>]', 'automation', ['network']],
	},
	'backlog:plan': {
		script: 'scripts/backlog/backlog-plan-cli.ts',
		description:
			'Print the whole backlog as a plan: ready now, waiting on what, waiting on a person, out of scope',
		category: 'AI tools',
		reference: ['[issue...] [--only]', 'automation', ['network']],
	},
	'backlog:budget': {
		script: 'scripts/backlog/backlog-budget-cli.ts',
		description: 'Say whether a backlogrun may start more work, keep watching, or finish',
		category: 'AI tools',
		reference: ['[options]', 'automation', ['none']],
	},
	cost: {
		script: 'scripts/cost-runtime/cost-cli.ts',
		description: "Report a run's token and credit cost from Claude Code's session transcripts",
		category: 'AI tools',
		reference: ['[--cut|--over]', 'automation', ['none']],
	},
	'doc:section': {
		script: 'scripts/document/document-section-cli.ts',
		description: 'Print one section of a markdown document, for a `file.md` → "Heading" reference',
		category: 'AI tools',
		reference: ['<file> <heading>', 'automation', ['none']],
	},
	'read:set': {
		script: 'scripts/document/read-set-cli.ts',
		description: 'Print what an entry point reads before it starts, and what that read costs',
		category: 'AI tools',
		reference: ['[<entry>] [--json]', 'automation', ['none']],
	},
	time: {
		script: 'scripts/time/time-cli.ts',
		description: "Report where a run's wall clock went: model wait, tool execution, human wait",
		category: 'AI tools',
		reference: ['[options]', 'maintainer', ['none']],
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
		reference: ['[--round <1|2>] | --level-only [--staged] [--json]', 'automation', ['files']],
	},
	'review:attest': {
		script: 'scripts/review/review-attest-cli.ts',
		description: 'Record, or verify, which checkout a /code-review actually read',
		category: 'AI tools',
		reference: ['<nonce> | --check', 'automation', ['files']],
	},
	'review:round2': {
		script: 'scripts/review/review-round2-cli.ts',
		description: 'Say whether the second /code-review round is due, or may be skipped entirely',
		category: 'AI tools',
		reference: ['[--round-1-closed] [--json]', 'automation', ['none']],
	},
	delegate: {
		script: 'scripts/delegation/delegation-cli.ts',
		description: 'Say whether a run step may go to a cheaper execution tier',
		category: 'AI tools',
		reference: ['<step> | --list', 'automation', ['none']],
	},
	'run:hold': {
		script: RUN_HOLD_SCRIPT,
		description: 'Claim this working tree for a run, or say which run already holds it',
		category: 'AI tools',
		reference: ['[issue]', 'automation', ['files']],
	},
	'run:release': {
		script: RUN_HOLD_SCRIPT,
		description: "Release this working tree's run record",
		category: 'AI tools',
		reference: ['[issue|--force]', 'automation', ['files']],
		default_script_arguments: ['--release'],
	},
	'run:carry': {
		script: 'scripts/run/run-carry-cli.ts',
		description: 'Carry one invocation’s budget across its own session cuts',
		category: 'AI tools',
		reference: ['<operation> [arguments...]', 'automation', ['files']],
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
		reference: ['[options]', 'automation', ['processes', 'notifications']],
	},
	'run:cut': {
		script: 'scripts/run/run-cut-cli.ts',
		description:
			'Cut a lane child before the gate and resume a fresh process from the persisted state',
		category: 'AI tools',
		reference: ['[--resume] <issue>', 'automation', ['files']],
	},
	'run:liveness': {
		script: 'scripts/run/run-liveness-cli.ts',
		description: 'Say whether a delegated unit is still working, or stopped without reporting',
		category: 'AI tools',
		reference: ['<issue> --output <path> [options]', 'automation', ['processes']],
	},
	'run:ending': {
		script: 'scripts/run/run-ending-cli.ts',
		description:
			'Classify how a dispatched lane child ended: merged, cut, abandoned mid-implementation, or unreadable',
		category: 'AI tools',
		reference: ['<issue> --output <path> [--repo <owner/repo>]', 'automation', ['network']],
	},
	'run:progress': {
		script: 'scripts/run/run-progress-cli.ts',
		description: 'Report an unattended run’s progress once it has gone quiet for an interval',
		category: 'AI tools',
		reference: ['[--wait|--mark]', 'automation', ['files']],
	},
	'run:prep': {
		script: 'scripts/run/run-prep-cli.ts',
		description:
			'Bundle the reads a run makes before its first edit: issue body and comments, state, dependency-update scope',
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['network']],
	},
	'run:merge': {
		script: 'scripts/run/run-merge-cli.ts',
		description:
			'Collapse a backlogrun merge event into one call: confirm the child, do the post-merge steps, offer the next child',
		category: 'AI tools',
		reference: [ISSUE_WITH_OPTIONS, 'automation', ['git', 'network']],
	},
	'lane:open': {
		...LANE_ARGUMENTS,
		description: 'Open a lane: a linked work tree with its own branch and its own port seed',
		category: 'AI tools',
		reference: [ISSUE_WITH_OPTIONS, 'automation', ['files', 'git']],
		default_script_arguments: ['open'],
	},
	'lane:close': {
		...LANE_ARGUMENTS,
		description: 'Close a lane, leaving no work tree, branch or directory behind',
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['files', 'git']],
		default_script_arguments: ['close'],
	},
	'lane:list': {
		...LANE_ARGUMENTS,
		description: 'List the open lanes: which issue, which ports, and where each one is',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
		default_script_arguments: ['list'],
	},
	'lane:prune': {
		...LANE_ARGUMENTS,
		description: 'Close every lane an interruption left without its work tree',
		category: 'AI tools',
		reference: ['', 'automation', ['files', 'git']],
		default_script_arguments: ['prune'],
	},
	'lane:output': {
		...LANE_ARGUMENTS,
		description: 'Record, or read back, where the unit running a lane’s child writes',
		category: 'AI tools',
		reference: ['<issue> [path]', 'automation', ['files']],
		default_script_arguments: ['output'],
	},
	'lane:dispatch': {
		...LANE_ARGUMENTS,
		description: 'Start a lane’s child as a detached process that outlives this session',
		category: 'AI tools',
		reference: ['<issue> <prompt>', 'automation', ['processes']],
		default_script_arguments: ['dispatch'],
	},
	'lane:await': {
		...LANE_ARGUMENTS,
		description:
			'Block until any of the named in-flight lane children completes; prints which one finished',
		category: 'AI tools',
		reference: ['<issue> [<issue>...]', 'automation', ['processes']],
		default_script_arguments: ['await'],
	},
	'investigation:guard': {
		script: 'scripts/delegation/investigation-guard.ts',
		description:
			'Claude Code hook: refuse a read once the unedited-read threshold is reached again (reads the tool call on stdin)',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
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
		reference: ['', 'automation', ['none']],
		// **No `tsx_arguments`, for the reason the other two guards declare none**
		// (joshuafolkken/kit#1342): declaring any disqualifies a command from in-process dispatch, and
		// this one runs in front of every shell call.
	},
	'run:watcher:guard': {
		script: 'scripts/run/run-watcher-guard-cli.ts',
		description:
			'Guard: exits non-zero when lane children are in-flight but the watcher has not pinged recently',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
	},
	'oracle:list': {
		script: 'scripts/rules/oracle-list-cli.ts',
		description: 'Print the decision oracles — commands that answer a rule question mechanically',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
	},
	eval: {
		script: 'scripts/eval/eval-run.ts',
		description: 'Run the agent rule-compliance scenarios (real Claude sessions)',
		category: 'AI tools',
		reference: ['[scenario...]', 'maintainer', ['processes', 'network']],
		// Kit-only: it replays kit's own distributed rules against real Claude sessions, so it means
		// nothing in a consumer project and is dropped from a consumer's help (joshuafolkken/kit#1988).
		is_kit_only: true,
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { AI_COMMANDS }
