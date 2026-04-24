import { PE, type CommandEntry } from './josh-command-types'

/* eslint-disable @typescript-eslint/naming-convention */
const HOOKS_COMMANDS: Record<string, CommandEntry> = {
	'prevent-main-commit': {
		script: 'scripts/prevent-main-commit.ts',
		description: 'Git hook: block commits to main',
		category: 'Git hooks',
	},
	'check-commit-message': {
		script: 'scripts/check-commit-message.ts',
		description: 'Git hook: validate commit message',
		category: 'Git hooks',
	},
	'hook:install': {
		shell: [...PE, 'lefthook', 'install'],
		description: 'Install git hooks',
		category: 'Git hooks',
	},
	'hook:uninstall': {
		shell: [...PE, 'lefthook', 'uninstall'],
		description: 'Uninstall git hooks',
		category: 'Git hooks',
	},
	'hook:commit': {
		shell: [...PE, 'lefthook', 'run', 'pre-commit'],
		description: 'Run pre-commit hooks manually',
		category: 'Git hooks',
	},
	'hook:push': {
		shell: [...PE, 'lefthook', 'run', 'pre-push'],
		description: 'Run pre-push hooks manually',
		category: 'Git hooks',
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { HOOKS_COMMANDS }
