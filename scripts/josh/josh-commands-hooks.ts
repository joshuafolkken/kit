import type { CommandEntry } from './josh-command-types'

const HOOKS_COMMANDS: Record<string, CommandEntry> = {
	'prevent-main-commit': {
		script: 'scripts/hooks/prevent-main-commit.ts',
		description: 'Git hook: block commits to main',
		category: 'Git hooks',
	},
	'check-commit-message': {
		script: 'scripts/hooks/check-commit-message.ts',
		description: 'Git hook: validate commit message',
		category: 'Git hooks',
	},
	'secretlint-scan': {
		script: 'scripts/security/secretlint-scan.ts',
		description: 'Git hook: scan staged files for secrets',
		category: 'Git hooks',
	},
	'pre-push-unit': {
		script: 'scripts/hooks/pre-push-unit.ts',
		description: 'Git hook: run unit tests, reusing a green gate recorded on the pushed tree',
		category: 'Git hooks',
	},
	'pre-commit-type-check': {
		script: 'scripts/gate/pre-commit-type-check.ts',
		description: 'Git hook: type-check, reusing a green gate recorded on the committed tree',
		category: 'Git hooks',
	},
}

export { HOOKS_COMMANDS }
