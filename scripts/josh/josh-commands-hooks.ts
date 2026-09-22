import type { CommandEntry } from './josh-command-types'

const HOOKS_COMMANDS: Record<string, CommandEntry> = {
	'prevent-main-commit': {
		script: 'scripts/hooks/prevent-main-commit.ts',
		description: 'Git hook: block commits to main',
		category: 'Git hooks',
		reference: ['', 'automation', ['none']],
	},
	'check-commit-message': {
		script: 'scripts/hooks/check-commit-message.ts',
		description: 'Git hook: validate commit message',
		category: 'Git hooks',
		reference: ['[<message-file>]', 'automation', ['none']],
	},
	'secretlint-scan': {
		script: 'scripts/security/secretlint-scan.ts',
		description: 'Git hook: scan staged files for secrets',
		category: 'Git hooks',
		reference: ['[paths...]', 'automation', ['none']],
	},
	'pre-push-unit': {
		script: 'scripts/hooks/pre-push-unit.ts',
		description: 'Git hook: run unit tests, reusing a green gate recorded on the pushed tree',
		category: 'Git hooks',
		reference: ['', 'automation', ['processes']],
	},
	'reserved-run': {
		script: 'scripts/hooks/reserved-run.ts',
		description: 'Git hook: run a command while holding a place in the machine-wide core budget',
		category: 'Git hooks',
		reference: ['<weight> -- <command...>', 'automation', ['processes']],
	},
	'pre-commit-type-check': {
		script: 'scripts/gate/pre-commit-type-check.ts',
		description: 'Git hook: type-check, reusing a green gate recorded on the committed tree',
		category: 'Git hooks',
		reference: ['', 'automation', ['processes']],
	},
}

export { HOOKS_COMMANDS }
