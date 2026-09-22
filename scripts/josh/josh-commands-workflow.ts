import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

const GIT_WORKFLOW_SCRIPT = 'scripts-ai/git-workflow.ts'
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
	// **The optional form, on both** (joshuafolkken/kit#1564). These two were the last commands
	// passing the mandatory `--env-file=.env`, which node resolves before the script's first line: on
	// a machine with no `.env` they died as `.env: not found` with exit code 9, even where
	// `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` existed as real environment variables — a cloud
	// session, and `followup` with them the merge step of every `fullrun` there. `doctor` was moved to
	// this form for the same reason in joshuafolkken/kit#869.
	//
	// Nothing is lost by relaxing it: both scripts already call `load_optional_environment()`
	// themselves, so the file is read either way and node's precedence — an existing environment
	// variable wins over the file — is node's own in both spellings.
	//
	// **What the mandatory flag was accidentally providing was noise**, and that is replaced rather
	// than dropped: `telegram_notify.send` now throws on missing credentials and on a failed send, so
	// `josh notify` exits non-zero instead of warning and answering 0.
	followup: {
		script: 'scripts-ai/git-followup-workflow.ts',
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
		script: 'scripts-ai/telegram-test.ts',
		description: 'Send Telegram notification',
		category: 'Workflow',
		reference: ['--task-type <type> --body <text>', 'automation', ['notifications']],
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
	},
	// The observation ledger's only commit path (joshuafolkken/kit#1756). `pnpm josh git` excludes the
	// ledger from what it stages, so without this command a parent's appended line has no route to the
	// default branch at all — and the recurrence count the promotion rule reads is a count of main.
	'observations:flush': {
		script: 'scripts/observations/observations-flush-cli.ts',
		description: 'Commit the observation ledger as a pull request of its own, and merge it',
		category: 'Workflow',
		reference: ['', 'automation', ['git', 'network']],
	},
	// The one write path for a `/code-review` round's findings (joshuafolkken/kit#2325). It appends a
	// `- rf:` line per finding — or one zero-finding line for a clean round — to the observation ledger,
	// so `observations:flush` commits them and the recurrence count survives the run.
	'review:record': {
		script: 'scripts/review/review-record-cli.ts',
		description: 'Record a review round’s findings in the observation ledger',
		category: 'Workflow',
		reference: ['--issue <N> [<category>:<severity>:<file> ...]', 'automation', ['files']],
	},
	// The reader over what `review:record` wrote (joshuafolkken/kit#2325): each recurring category’s
	// count, and the number of zero-finding rounds that distinguishes a quiet category from an unwatched one.
	'review:findings': {
		script: 'scripts/review/review-findings-cli.ts',
		description: 'Count review findings by category from the observation ledger',
		category: 'Workflow',
		reference: ['', 'developer', ['files']],
	},
	// After a behavior-change Issue merges, re-run its declared baseline and print before/after; a value
	// that did not move appends a refuted-premise line to the observation ledger (joshuafolkken/kit#2212).
	'measure:rerun': {
		script: 'scripts/issue/measure-rerun-cli.ts',
		description: 'Re-run a merged issue’s baseline command and print the before/after pair',
		category: 'Workflow',
		reference: ['<path>', 'automation', ['processes', 'files']],
	},
	// A script rather than an `sh -c` chain, because it has a precondition to enforce: run inside a
	// linked work tree it would hijack the default branch from every other one (joshuafolkken/kit#1535).
	'main:sync': {
		script: 'scripts/git/main-sync.ts',
		description: 'Checkout default branch and pull latest (refuses inside a lane)',
		category: 'Workflow',
		reference: ['', 'developer', ['git', 'network']],
	},
	// A script rather than an `sh -c` chain, because the strategy has to be named rather than left to
	// the caller's git configuration: the `git pull` this replaced aborted with `Need to specify how
	// to reconcile divergent branches` on exactly the diverged branch the command exists for
	// (joshuafolkken/kit#1659).
	'main:merge': {
		script: 'scripts/git/main-merge.ts',
		description: 'Merge origin default branch into the current branch',
		category: 'Workflow',
		reference: ['', 'developer', ['git', 'network']],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { WORKFLOW_COMMANDS }
