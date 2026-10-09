import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

const GIT_WORKFLOW_SCRIPT = 'scripts/git/git-workflow.ts'
const GIT_MESSAGE_ARGUMENTS = '[-y] <message>'

/* eslint-disable @typescript-eslint/naming-convention */
const WORKFLOW_COMMANDS: Record<string, CommandEntry> = {
	git: {
		script: GIT_WORKFLOW_SCRIPT,
		description: 'Git workflow helper',
		category: 'Workflow',
		reference: [GIT_MESSAGE_ARGUMENTS, 'developer', ['git', 'network']],
	},
	pr: {
		script: GIT_WORKFLOW_SCRIPT,
		description: 'Create PR only (skip commit and push)',
		category: 'Workflow',
		// Not `GIT_MESSAGE_ARGUMENTS`: `-y` is already in the default arguments below, so advertising
		// it would document a flag that cannot change what this command does.
		reference: ['<message>', 'developer', ['network']],
		default_script_arguments: ['-y', '--skip-commit', '--skip-push'],
	},
	// **The optional form, on both**. The mandatory `--env-file=.env` is resolved by node before the
	// script's first line: on a machine with no `.env` it dies as `.env: not found` with exit code 9,
	// even where `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` exist as real environment variables — a
	// cloud session, and `followup` with them the merge step of every `fullrun` there.
	//
	// Nothing is lost by relaxing it: both scripts already load `.env` through `josh_environment_file`
	// themselves, so the file is read either way and node's precedence — an existing environment
	// variable wins over the file — is node's own in both spellings.
	//
	// **A missing credential still fails loudly**: `telegram_notify.send` throws on missing credentials
	// and on a failed send, so `josh notify` exits non-zero instead of warning and answering 0.
	followup: {
		script: 'scripts/followup/git-followup-workflow.ts',
		description: 'Follow-up git workflow',
		category: 'Workflow',
		reference: [
			'<title> [--notify-message <text>]',
			'automation',
			['git', 'network', 'notifications'],
		],
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
	},
	notify: {
		script: 'scripts/notify/telegram-test.ts',
		description: 'Send Telegram notification',
		category: 'Workflow',
		reference: ['--task-type <type> --body <text>', 'automation', ['notifications']],
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
	},
	// One observation-ledger sighting: the key's count, the append and the second-sighting verdict,
	// which a run used to type as a `cat | grep -c` and judge by hand.
	'observation:record': {
		script: 'scripts/observations/observation-record-cli.ts',
		description: 'Record an observation sighting and answer whether it is now filed',
		category: 'Workflow',
		reference: ['<key> <depth> <where> <what> [--checkout <path>]', 'automation', ['files']],
	},
	// The observation ledger's commit path for the lines no run's own commit carried:
	// a lane's lines sit in the primary checkout, which
	// its commit cannot see, and the recurrence count the promotion rule reads is a count of main.
	'observations:flush': {
		script: 'scripts/observations/observations-flush-cli.ts',
		description: 'Commit the observation ledger as a pull request of its own, and merge it',
		category: 'Workflow',
		reference: ['', 'automation', ['git', 'network']],
	},
	// The one write path for a `/code-review` round's findings, plus the
	// `--check` gate `followup` runs before it merges. It appends a `- rf:`
	// line per finding — or one zero-finding line for a clean round — to the observation ledger, so
	// `observations:flush` commits them and the recurrence count survives the run.
	'review:record': {
		script: 'scripts/review/review-record-cli.ts',
		description: 'Record a review round’s findings, or check a round was recorded',
		category: 'Workflow',
		reference: [
			'--issue <N> [<category>:<severity>:<file> ...] | --check --issue <N>',
			'automation',
			['files'],
		],
	},
	// The reader over what `review:record` wrote: each recurring category’s
	// count, and the number of zero-finding rounds that distinguishes a quiet category from an unwatched one.
	'review:findings': {
		script: 'scripts/review/review-findings-cli.ts',
		description: 'Count review findings by category from the observation ledger',
		category: 'Workflow',
		reference: ['', 'developer', ['files']],
	},
	// After a behavior-change Issue merges, re-run its declared baseline and print before/after; a value
	// that did not move appends a refuted-premise line to the observation ledger.
	'measure:rerun': {
		script: 'scripts/issue/measure-rerun-cli.ts',
		description: 'Re-run a merged issue’s baseline command and print the before/after pair',
		category: 'Workflow',
		reference: ['<issue-number>', 'automation', ['network', 'processes', 'files']],
	},
	// A script rather than an `sh -c` chain, because it has a precondition to enforce: run inside a
	// linked work tree it would hijack the default branch from every other one.
	'main:sync': {
		script: 'scripts/git/main-sync.ts',
		description:
			'Checkout default branch, pull latest, and prune merged remote-gone branches (refuses inside a lane)',
		category: 'Workflow',
		reference: ['', 'developer', ['git', 'network']],
	},
	// A script rather than an `sh -c` chain, because the strategy has to be named rather than left to
	// the caller's git configuration: a bare `git pull` aborts with `Need to specify how to reconcile
	// divergent branches` on exactly the diverged branch the command exists for.
	'main:merge': {
		script: 'scripts/git/main-merge.ts',
		description: 'Merge origin default branch into the current branch',
		category: 'Workflow',
		reference: ['', 'developer', ['git', 'network']],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { WORKFLOW_COMMANDS }
