const JF_PREFIX = 'jf-'
const JOSH_PREFIX = 'josh '

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
	'lint',
	'lint:prettier',
	'lint:eslint',
	'format',
	'format:prettier',
	'format:eslint',
	'cspell',
	'cspell:dot',
	'test:unit',
	'lefthook:install',
	'lefthook:uninstall',
	'lefthook:commit',
	'lefthook:push',
	'main:sync',
	'main:merge',
	'check',
	'check:ci',
])

function migrate_jf_value(value: string): string {
	if (!value.startsWith(JF_PREFIX)) return value

	return `${JOSH_PREFIX}${value.slice(JF_PREFIX.length)}`
}

function apply_jf_migrations(scripts: Record<string, string>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(scripts).map(([key, value]) => [key, migrate_jf_value(value)]),
	)
}

function remove_retired_scripts(scripts: Record<string, string>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(scripts).filter(([key]) => !RETIRED_MANAGED_SCRIPTS.has(key)),
	)
}

export { apply_jf_migrations, remove_retired_scripts, RETIRED_MANAGED_SCRIPTS }
