import { ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

/* eslint-disable @typescript-eslint/naming-convention */
const WORKFLOW_COMMANDS: Record<string, CommandEntry> = {
	git: {
		script: 'scripts-ai/git-workflow.ts',
		description: 'Git workflow helper',
		category: 'Workflow',
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
