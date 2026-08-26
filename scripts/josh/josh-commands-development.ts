import { ESLINT_CACHE_FLAGS, GATE_COMMAND, PE, type CommandEntry } from './josh-command-types'

/* eslint-disable @typescript-eslint/naming-convention */
const DEV_COMMANDS: Record<string, CommandEntry> = {
	[GATE_COMMAND]: {
		script: 'scripts/verification-gate.ts',
		description: 'Run lint, type check, spell check and unit tests concurrently',
		category: 'Development',
	},
	lint: {
		script: 'scripts/lint-parallel.ts',
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
		// prettier first here, unlike `format:edited`, and deliberately: `eslint --fix` exits 1
		// whenever a non-autofixable error remains, so putting it first behind `&&` would mean one
		// unused variable anywhere in the tree stops prettier from running at all.
		shell: [
			'sh',
			'-c',
			'pnpm exec prettier --write . && pnpm exec eslint . --fix --cache --cache-strategy content',
		],
		description: 'Format code with prettier and eslint',
		category: 'Development',
		argument_targets: ['format:prettier', 'format:eslint'],
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
	'format:edited': {
		script: 'scripts/format-edited-file.ts',
		description: 'Claude Code hook: format the file just edited (reads the tool call on stdin)',
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
		script: 'scripts/test-unit-guard.ts',
		description: 'Run unit tests with Vitest (skips when absent or no test files)',
		category: 'Development',
	},
	'test:watch': {
		shell: [...PE, 'vitest', 'watch'],
		description: 'Run unit tests in watch mode',
		category: 'Development',
	},
	'test:ui': {
		shell: [...PE, 'vitest', '--ui'],
		description: 'Run unit tests with browser UI',
		category: 'Development',
	},
	'e2e:retry-check': {
		script: 'scripts/e2e-retry-check.ts',
		description: 'Report whether the preview server crashed during a failed E2E attempt (CI)',
		category: 'Development',
	},
	'test:e2e': {
		script: 'scripts/test-e2e-guard.ts',
		description: 'Run E2E tests with Playwright (skips when absent or no e2e files)',
		category: 'Development',
	},
	test: {
		shell: ['sh', '-c', 'pnpm josh test:unit && pnpm josh test:e2e'],
		description: 'Run unit and E2E tests',
		category: 'Development',
		argument_targets: ['test:unit', 'test:e2e'],
	},
	check: {
		shell: [...PE, 'tsc', '--noEmit'],
		description: 'Type-check TypeScript project',
		category: 'Development',
	},
	port: {
		script: 'scripts/ports/port-command.ts',
		description: 'Print the PORT_SEED-resolved dev or preview port',
		category: 'Development',
	},
	health: {
		script: 'scripts/health-check.ts',
		description: 'Show project health status',
		category: 'Development',
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { DEV_COMMANDS }
