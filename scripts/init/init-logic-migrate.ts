import { safe_chain_preinstall } from '#scripts/safe-chain/preinstall-command'

const PREINSTALL_KEY = 'preinstall'
const JF_PREFIX = 'jf-'
const JOSH_PREFIX = 'josh '

// The plain values kit wrote before its scripts became josh subcommands (#80). `check` is left out:
// its value is the one `sv create` writes itself, so it cannot be told apart from the project's own.
const PRE_JOSH_SCRIPT_VALUES: ReadonlyMap<string, string> = new Map([
	['lint', 'pnpm lint:prettier && pnpm lint:eslint'],
	['lint:prettier', 'prettier --check .'],
	['lint:eslint', 'eslint . --cache --cache-strategy content'],
	['format', 'pnpm format:prettier && pnpm format:eslint'],
	['format:prettier', 'prettier --write .'],
	['format:eslint', 'eslint . --fix --cache --cache-strategy content'],
	['cspell', 'cspell lint --no-must-find-files --no-progress "**/*.{ts,js,md,yaml,yml,json}"'],
	['cspell:dot', 'pnpm cspell . --dot'],
	['test:unit', 'vitest run'],
	['lefthook:install', 'lefthook install'],
	['lefthook:uninstall', 'lefthook uninstall'],
	['lefthook:commit', 'lefthook run pre-commit'],
	['lefthook:push', 'lefthook run pre-push'],
	['main:sync', 'git checkout main && git pull'],
	['main:merge', 'git pull origin main'],
	['check:ci', 'svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --threshold error'],
])

const RETIRED_MANAGED_SCRIPTS = new Set<string>([
	'git',
	'git:followup',
	'telegram:test',
	'audit:security',
	'prep',
	'issue:prep',
	'prevent-main-commit',
	'check-commit-message',
	'version:major',
	'version:minor',
	'version:patch',
	'version:current',
	'overrides:check',
	'test:e2e',
	'test',
	'latest',
	'latest:corepack',
	'latest:update',
	'check',
	'check:svelte',
	'check:svelte:ci',
	...PRE_JOSH_SCRIPT_VALUES.keys(),
])

function migrate_jf_value(value: string): string {
	if (!value.startsWith(JF_PREFIX)) return value

	return `${JOSH_PREFIX}${value.slice(JF_PREFIX.length)}`
}

function migrate_script(key: string, value: string): string {
	const migrated = migrate_jf_value(value)

	return key === PREINSTALL_KEY ? safe_chain_preinstall.migrate_preinstall(migrated) : migrated
}

function apply_jf_migrations(scripts: Record<string, string>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(scripts).map(([key, value]) => [key, migrate_script(key, value)]),
	)
}

function is_kit_written(key: string, value: string): boolean {
	if (value.startsWith(JOSH_PREFIX) || value.startsWith(JF_PREFIX)) return true

	return PRE_JOSH_SCRIPT_VALUES.get(key) === value
}

// A retired name alone does not make a script kit's: `sv create` writes its own `check`, which must
// survive `josh init`. Only a value kit itself wrote is retired.
function is_retired_script(key: string, value: string): boolean {
	return RETIRED_MANAGED_SCRIPTS.has(key) && is_kit_written(key, value)
}

function remove_retired_scripts(scripts: Record<string, string>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(scripts).filter(([key, value]) => !is_retired_script(key, value)),
	)
}

export { apply_jf_migrations, remove_retired_scripts, RETIRED_MANAGED_SCRIPTS }
