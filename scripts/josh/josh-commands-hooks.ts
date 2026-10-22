import type { CommandEntry } from './josh-command-types'

const HOOKS_COMMANDS: Record<string, CommandEntry> = {
	'prevent-main-commit': {
		script: 'scripts/hooks/prevent-main-commit.ts',
		description: 'Git hook: block commits to main',
		category: 'Git hooks',
		reference: ['', 'automation', ['none']],
		usage: { examples: [{ arguments: '', note: 'run by the pre-commit hook' }] },
	},
	'check-commit-message': {
		script: 'scripts/hooks/check-commit-message-main.ts',
		description: 'Git hook: validate commit message',
		category: 'Git hooks',
		reference: ['[<message-file>]', 'automation', ['none']],
		usage: {
			examples: [{ arguments: '.git/COMMIT_EDITMSG', note: 'run by the commit-msg hook' }],
		},
	},
	'secretlint-scan': {
		script: 'scripts/security/secretlint-scan.ts',
		description: 'Git hook: scan staged files for secrets',
		category: 'Git hooks',
		reference: ['[paths...]', 'automation', ['none']],
		usage: {
			examples: [{ arguments: 'src/app.ts .env.example', note: 'the staged paths' }],
		},
	},
	'pre-commit-lint': {
		script: 'scripts/hooks/pre-commit-lint.ts',
		description: 'Git hook: run cspell, prettier or eslint over staged files from a content cache',
		category: 'Git hooks',
		reference: ['<cspell|prettier|eslint> [paths...]', 'automation', ['files']],
		usage: {
			examples: [
				{ arguments: 'cspell src/app.ts' },
				{ arguments: 'prettier src/app.ts' },
				{ arguments: 'eslint src/app.ts' },
			],
		},
	},
	'pre-push-unit': {
		script: 'scripts/hooks/pre-push-unit.ts',
		description: 'Git hook: run unit tests, reusing a green gate recorded on the pushed tree',
		category: 'Git hooks',
		reference: ['', 'automation', ['processes']],
		usage: { examples: [{ arguments: '' }] },
	},
	'reserved-run': {
		script: 'scripts/hooks/reserved-run.ts',
		description: 'Git hook: run a command while holding a place in the machine-wide core budget',
		category: 'Git hooks',
		reference: ['<weight> [--memory <MB>] -- <command...>', 'automation', ['processes']],
		usage: {
			examples: [
				{ arguments: '2 -- pnpm install', note: 'hold 2 cores while installing' },
				{ arguments: '1 -- pnpm josh audit', note: 'hold 1 core while scanning' },
				{ arguments: '1 --memory 3000 -- <command>', note: 'hold 3,000 MB beside the core' },
			],
		},
	},
	'pre-commit-type-check': {
		script: 'scripts/gate/pre-commit-type-check.ts',
		description: 'Git hook: type-check, reusing a green gate recorded on the committed tree',
		category: 'Git hooks',
		reference: ['', 'automation', ['processes']],
		usage: { examples: [{ arguments: '' }] },
	},
}

export { HOOKS_COMMANDS }
