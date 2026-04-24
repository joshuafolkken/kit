import { ESLINT_CACHE_FLAGS, PE, type CommandEntry } from './josh-command-types'

/* eslint-disable @typescript-eslint/naming-convention */
const DEV_COMMANDS: Record<string, CommandEntry> = {
	lint: {
		shell: [
			'sh',
			'-c',
			'pnpm exec prettier --check . && pnpm exec eslint . --cache --cache-strategy content',
		],
		description: 'Check code with prettier and eslint',
		category: 'Development',
	},
	'lint:prettier': {
		shell: [...PE, 'prettier', '--check', '.'],
		description: 'Check formatting with prettier',
		category: 'Development',
	},
	'lint:eslint': {
		shell: [...PE, 'eslint', '.', ...ESLINT_CACHE_FLAGS],
		description: 'Check code with eslint',
		category: 'Development',
	},
	format: {
		shell: [
			'sh',
			'-c',
			'pnpm exec prettier --write . && pnpm exec eslint . --fix --cache --cache-strategy content',
		],
		description: 'Format code with prettier and eslint',
		category: 'Development',
	},
	'format:prettier': {
		shell: [...PE, 'prettier', '--write', '.'],
		description: 'Format code with prettier',
		category: 'Development',
	},
	'format:eslint': {
		shell: [...PE, 'eslint', '.', '--fix', ...ESLINT_CACHE_FLAGS],
		description: 'Fix eslint issues',
		category: 'Development',
	},
	cspell: {
		shell: [
			...PE,
			'cspell',
			'lint',
			'--no-must-find-files',
			'--no-progress',
			'**/*.{ts,js,md,yaml,yml,json}',
		],
		description: 'Run spell check',
		category: 'Development',
	},
	'cspell:dot': {
		shell: [...PE, 'cspell', '.', '--dot'],
		description: 'Run spell check including dotfiles',
		category: 'Development',
	},
	'test:unit': {
		shell: [...PE, 'vitest', 'run'],
		description: 'Run unit tests',
		category: 'Development',
	},
	'test:e2e': {
		shell: [...PE, 'playwright', 'test'],
		description: 'Run E2E tests with Playwright',
		category: 'Development',
	},
	test: {
		shell: ['sh', '-c', 'pnpm josh test:unit && pnpm josh test:e2e'],
		description: 'Run unit and E2E tests',
		category: 'Development',
	},
	check: {
		shell: [...PE, 'tsc', '--noEmit'],
		description: 'Type-check TypeScript project',
		category: 'Development',
	},
	'check:svelte': {
		shell: ['sh', '-c', 'pnpm exec svelte-kit sync && pnpm exec svelte-fast-check --incremental'],
		description: 'Type-check SvelteKit project (fast incremental)',
		category: 'Development',
		requires_sveltekit: true,
	},
	'check:svelte:ci': {
		shell: [
			'sh',
			'-c',
			'pnpm exec svelte-kit sync && pnpm exec svelte-check --tsconfig ./tsconfig.json',
		],
		description: 'Type-check SvelteKit project (CI)',
		category: 'Development',
		requires_sveltekit: true,
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { DEV_COMMANDS }
