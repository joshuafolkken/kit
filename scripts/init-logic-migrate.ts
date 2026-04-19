const JF_PREFIX = 'jf-'
const JOSH_PREFIX = 'josh '

function migrate_jf_value(value: string): string {
	if (!value.startsWith(JF_PREFIX)) return value

	return `${JOSH_PREFIX}${value.slice(JF_PREFIX.length)}`
}

function apply_jf_migrations(scripts: Record<string, string>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(scripts).map(([key, value]) => [key, migrate_jf_value(value)]),
	)
}

export { apply_jf_migrations }
