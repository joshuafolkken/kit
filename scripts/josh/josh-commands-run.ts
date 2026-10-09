import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

// The run-lifecycle registry (`run:hold` through `run:step`), split out of `josh-commands-ai.ts` so
// that file stays under its 300-code-line limit, as `BACKLOG_COMMANDS` and `LANE_COMMANDS` are. It
// is spread into `AI_COMMANDS` at the place the entries belong, so the generated catalog keeps their
// order.

// One script answers both `run:hold` and `run:release`; the flag below is what tells them apart.
const RUN_HOLD_SCRIPT = 'scripts/run/hold/run-hold-cli.ts'

/* eslint-disable @typescript-eslint/naming-convention */
const RUN_COMMANDS: Record<string, CommandEntry> = {
	'run:hold': {
		script: RUN_HOLD_SCRIPT,
		description: 'Claim this working tree for a run, or say which run already holds it',
		category: 'AI tools',
		reference: ['[<issue> [--fullrun | --halfrun-stop | --prrun-stop]]', 'automation', ['files']],
	},
	'run:release': {
		script: RUN_HOLD_SCRIPT,
		description: "Release this working tree's run record",
		category: 'AI tools',
		reference: ['[issue|--force]', 'automation', ['files']],
		default_script_arguments: ['--release'],
	},
	'run:tidy': {
		script: 'scripts/run/tidy/run-tidy-cli.ts',
		description: 'Close merged lanes and drop stashes whose issues are all merged',
		category: 'AI tools',
		reference: ['', 'automation', ['git', 'network', 'files']],
	},
	'run:carry': {
		script: 'scripts/run/carry/run-carry-cli.ts',
		// `--stopped` sends the stop confirmation, so the Telegram credentials come from `.env` as for
		// `run:wake` below.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description: 'Carry one invocation’s budget across its own session cuts',
		category: 'AI tools',
		reference: ['<operation> [arguments...]', 'automation', ['files']],
	},
	'run:add': {
		script: 'scripts/run/add/run-add-cli.ts',
		description: 'Add issues to a live backlogrun, ahead of the queue unless --no-priority',
		category: 'AI tools',
		reference: ['<issue...> [--no-priority]', 'automation', ['network', 'files']],
	},
	'run:wake': {
		script: 'scripts/run/wake/run-wake-cli.ts',
		// `.env` rather than the ambient environment:
		// the failure warning needs the Telegram credentials, the same
		// reasons `notify` and `followup` carry these flags.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description: 'Wake the next session of a cut backlogrun from outside the conversation',
		category: 'AI tools',
		reference: ['[options]', 'automation', ['processes', 'notifications']],
	},
	'run:cut': {
		script: 'scripts/run/cut/run-cut-cli.ts',
		description: 'Cut a lane child before the gate and resume a fresh process',
		category: 'AI tools',
		reference: ['[--resume] <issue> [--impl] [--handoff <path>]', 'automation', ['files']],
	},
	'run:liveness': {
		script: 'scripts/run/run-liveness-cli.ts',
		description: 'Say whether a delegated unit is still working, or stopped without reporting',
		category: 'AI tools',
		reference: ['<issue> --output <path> [options]', 'automation', ['processes']],
	},
	'run:ending': {
		script: 'scripts/run/run-ending-cli.ts',
		description: 'Classify how a dispatched lane child ended (merged, cut, abandoned, unreadable)',
		category: 'AI tools',
		reference: ['<issue> --output <path> [--repo <owner/repo>]', 'automation', ['network']],
	},
	'run:progress': {
		script: 'scripts/run/progress/run-progress-cli.ts',
		description: 'Report an unattended run’s progress once it has gone quiet for an interval',
		category: 'AI tools',
		reference: [
			'[--once | --wait] [--interval <minutes>] [--hours <hours>] [--repo <owner/repo>] [--output <path>] | --mark | --path',
			'automation',
			['files'],
		],
	},
	'run:board': {
		script: 'scripts/run/board/run-board-cli.ts',
		// `--every` pushes its frame as a Telegram, so the credentials come from `.env` as for `run:carry`.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description: 'Draw a live board of the running backlogrun, redrawn every second',
		category: 'AI tools',
		reference: ['[--once | --chat | --every <minutes>]', 'automation', ['files', 'network']],
	},
	'run:prep': {
		script: 'scripts/run/run-prep-cli.ts',
		description: 'Bundle a run’s pre-edit reads: body, comments, state, dependency scope',
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['network']],
	},
	// The entry sequence a lane opened on, folded into one call: claim the tree,
	// read the budget, gather the issue reads and decide the pre-implementation step. `run:hold`,
	// `cost --cut`, `run:prep` and `run:step` were four round trips re-billing a lane's full context each.
	'run:entry': {
		script: 'scripts/run/entry/run-entry-cli.ts',
		// A `busy` hold or an `over` budget sends the stop confirmation.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		description:
			'Open a run in one call: claim the tree, read the budget, bundle the reads, decide the pre-implementation step',
		category: 'AI tools',
		reference: ['<issue> [--to <command>]', 'automation', ['git', 'network', 'files']],
	},
	'run:status': {
		script: 'scripts/run/run-status-cli.ts',
		description: 'Bundle a run’s read-only status: issue state, cost verdict, carry counters',
		category: 'AI tools',
		reference: ['<issue> [--repo <owner/repo>]', 'automation', ['network']],
	},
	'run:next': {
		script: 'scripts/run/run-next-cli.ts',
		description: 'Print the next step a fullrun takes, computed from the run’s state',
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['network']],
	},
	'run:step': {
		script: 'scripts/run/run-step-cli.ts',
		description:
			'Print the run’s next single action, computed from the event stream, carry record and issue state',
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['network', 'files']],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { RUN_COMMANDS }
