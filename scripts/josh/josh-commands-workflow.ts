import { ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

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
	followup: {
		script: 'scripts-ai/git-followup-workflow.ts',
		description: 'Follow-up git workflow',
		category: 'Workflow',
		tsx_arguments: ENV_FILE_FLAGS,
	},
	notify: {
		script: 'scripts-ai/telegram-test.ts',
		description: 'Send Telegram notification',
		category: 'Workflow',
		tsx_arguments: ENV_FILE_FLAGS,
	},
	'main:sync': {
		shell: [
			'sh',
			'-c',
			'DEFAULT=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed "s|refs/remotes/origin/||"); git checkout "${DEFAULT:-main}" && git pull',
		],
		description: 'Checkout default branch and pull latest',
		category: 'Workflow',
	},
	'main:merge': {
		shell: [
			'sh',
			'-c',
			'DEFAULT=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed "s|refs/remotes/origin/||"); git pull origin "${DEFAULT:-main}"',
		],
		description: 'Pull latest from origin default branch',
		category: 'Workflow',
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { WORKFLOW_COMMANDS }
