import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

const GIT_WORKFLOW_SCRIPT = 'scripts-ai/git-workflow.ts'

/* eslint-disable @typescript-eslint/naming-convention */
const WORKFLOW_COMMANDS: Record<string, CommandEntry> = {
	git: {
		script: GIT_WORKFLOW_SCRIPT,
		description: 'Git workflow helper',
		category: 'Workflow',
	},
	pr: {
		script: GIT_WORKFLOW_SCRIPT,
		description: 'Create PR only (skip commit and push)',
		category: 'Workflow',
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
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
	},
	notify: {
		script: 'scripts-ai/telegram-test.ts',
		description: 'Send Telegram notification',
		category: 'Workflow',
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
	},
	// A script rather than an `sh -c` chain, because it has a precondition to enforce: run inside a
	// linked work tree it would hijack the default branch from every other one (joshuafolkken/kit#1535).
	'main:sync': {
		script: 'scripts/git/main-sync.ts',
		description: 'Checkout default branch and pull latest (refuses inside a lane)',
		category: 'Workflow',
	},
	// A script rather than an `sh -c` chain, because the strategy has to be named rather than left to
	// the caller's git configuration: the `git pull` this replaced aborted with `Need to specify how
	// to reconcile divergent branches` on exactly the diverged branch the command exists for
	// (joshuafolkken/kit#1659).
	'main:merge': {
		script: 'scripts/git/main-merge.ts',
		description: 'Merge origin default branch into the current branch',
		category: 'Workflow',
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { WORKFLOW_COMMANDS }
