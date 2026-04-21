const ENV_FILE_FLAGS: ReadonlyArray<string> = ['--env-file=.env']

type CommandCategory =
	| 'Development'
	| 'Project'
	| 'Workflow'
	| 'Versioning'
	| 'Maintenance'
	| 'Git hooks'
	| 'AI tools'

interface CommandEntry {
	script?: string
	shell?: ReadonlyArray<string>
	description: string
	category: CommandCategory
	tsx_arguments?: ReadonlyArray<string>
	requires_sveltekit?: true
}

const CATEGORY_ORDER: ReadonlyArray<CommandCategory> = [
	'Development',
	'Project',
	'Workflow',
	'Versioning',
	'Maintenance',
	'Git hooks',
	'AI tools',
]

const PE = ['pnpm', 'exec'] as const
const ESLINT_CACHE_FLAGS = ['--cache', '--cache-strategy', 'content'] as const

/* eslint-disable @typescript-eslint/naming-convention */
const COMMAND_MAP: Record<string, CommandEntry> = {
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
	init: {
		script: 'scripts/init.ts',
		description: 'Initialize config in a new project',
		category: 'Project',
	},
	sync: { script: 'scripts/sync.ts', description: 'Sync config files', category: 'Project' },
	install: {
		script: 'scripts/install-bin.ts',
		description: 'Install josh to ~/.local/bin',
		category: 'Project',
	},
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
		shell: ['sh', '-c', 'git checkout main && git pull'],
		description: 'Checkout main and pull latest',
		category: 'Workflow',
	},
	'main:merge': {
		shell: ['git', 'pull', 'origin', 'main'],
		description: 'Pull latest from origin main',
		category: 'Workflow',
	},
	bump: {
		script: 'scripts/bump-version.ts',
		description: 'Bump package version',
		category: 'Versioning',
	},
	version: {
		script: 'scripts/version-check.ts',
		description: 'Show current and latest @joshuafolkken/kit version',
		category: 'Versioning',
	},
	overrides: {
		script: 'scripts/overrides-check.ts',
		description: 'Check pnpm overrides for drift',
		category: 'Maintenance',
	},
	audit: {
		script: 'scripts/security-audit.ts',
		description: 'Run security audit',
		category: 'Maintenance',
	},
	latest: {
		shell: ['sh', '-c', 'corepack use pnpm@latest && pnpm update --latest && josh audit'],
		description: 'Update pnpm, dependencies, and run security audit',
		category: 'Maintenance',
	},
	'latest:corepack': {
		shell: ['corepack', 'use', 'pnpm@latest'],
		description: 'Update pnpm via corepack',
		category: 'Maintenance',
	},
	'latest:update': {
		shell: ['pnpm', 'update', '--latest'],
		description: 'Update all dependencies to latest',
		category: 'Maintenance',
	},
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
	prep: {
		script: 'scripts-ai/prep.ts',
		description: 'Pre-implementation preparation',
		category: 'AI tools',
	},
	issue: {
		script: 'scripts-ai/issue-prep.ts',
		description: 'Fetch GitHub issue details',
		category: 'AI tools',
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

const ALIASES: Record<string, string> = {
	l: 'lint',
	lp: 'lint:prettier',
	le: 'lint:eslint',
	f: 'format',
	fp: 'format:prettier',
	fe: 'format:eslint',
	sp: 'cspell',
	sd: 'cspell:dot',
	t: 'test',
	tu: 'test:unit',
	te: 'test:e2e',
	c: 'check',
	sv: 'check:svelte',
	sc: 'check:svelte:ci',
	i: 'init',
	sy: 'sync',
	il: 'install',
	g: 'git',
	fu: 'followup',
	nf: 'notify',
	ms: 'main:sync',
	mm: 'main:merge',
	bp: 'bump',
	v: 'version',
	ov: 'overrides',
	a: 'audit',
	u: 'latest',
	lc: 'latest:corepack',
	lu: 'latest:update',
	pm: 'prevent-main-commit',
	cm: 'check-commit-message',
	hi: 'hook:install',
	hu: 'hook:uninstall',
	hc: 'hook:commit',
	hp: 'hook:push',
	pp: 'prep',
	is: 'issue',
}

export type { CommandCategory, CommandEntry }
export { ALIASES, CATEGORY_ORDER, COMMAND_MAP }
