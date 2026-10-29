import { createHash } from 'node:crypto'

type Grant = readonly [string, string]

const CONFIG_FLAG = '-c'
const PROFILE_PREFIX = 'josh_lane'

function profile_names(grants: ReadonlyArray<Grant>): ReadonlyArray<string> {
	const digest = createHash('sha256').update(JSON.stringify(grants)).digest('hex')

	return grants.map((_, index) => `${PROFILE_PREFIX}_${digest}_${String(index)}`)
}

function profile_config(grant: Grant, index: number, names: ReadonlyArray<string>): string {
	const [target, access] = grant
	const parent = names[index + 1]
	const inheritance = parent === undefined ? '' : `,extends=${JSON.stringify(parent)}`
	const filesystem = `filesystem={${JSON.stringify(target)}=${JSON.stringify(access)}}`

	return `permissions.${String(names[index])}={${filesystem}${inheritance},network={enabled=true}}`
}

// CLI dotted keys split dots inside quoted paths too. Keep each path in an inline TOML table,
// inheriting the next grant, so no argument grows with the registered worktree count. Content-derived
// names also keep the generated chain apart from user-defined permission profiles.
function build(grants: ReadonlyArray<Grant>): ReadonlyArray<string> {
	const names = profile_names(grants)

	return [
		CONFIG_FLAG,
		`default_permissions=${JSON.stringify(names[0])}`,
		...grants.flatMap((grant, index) => [CONFIG_FLAG, profile_config(grant, index, names)]),
	]
}

const codex_permission_arguments = { build }

export { codex_permission_arguments }
