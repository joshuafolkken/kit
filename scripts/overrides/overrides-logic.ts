import { package_pnpm_schema, package_with_deps_schema } from './schemas'

interface AddedEntry {
	key: string
	value: string
}

interface RemovedEntry {
	key: string
	value: string
}

interface ModifiedEntry {
	key: string
	old_value: string
	new_value: string
}

interface OverridesDiff {
	is_changed: boolean
	added: Array<AddedEntry>
	removed: Array<RemovedEntry>
	modified: Array<ModifiedEntry>
}

function find_added(
	snapshot_keys: Set<string>,
	current: Record<string, string>,
): Array<AddedEntry> {
	return Object.entries(current)
		.filter(([key]) => !snapshot_keys.has(key))
		.map(([key, value]) => ({ key, value }))
}

function find_removed(
	current_keys: Set<string>,
	snapshot: Record<string, string>,
): Array<RemovedEntry> {
	return Object.entries(snapshot)
		.filter(([key]) => !current_keys.has(key))
		.map(([key, value]) => ({ key, value }))
}

function find_modified(
	snapshot: Record<string, string>,
	current: Record<string, string>,
): Array<ModifiedEntry> {
	return Object.entries(snapshot)
		.filter(([key]) => key in current && snapshot[key] !== current[key])
		.map(([key, old_value]) => ({ key, old_value, new_value: current[key] ?? '' }))
}

function compare(snapshot: Record<string, string>, current: Record<string, string>): OverridesDiff {
	const snapshot_keys = new Set(Object.keys(snapshot))
	const current_keys = new Set(Object.keys(current))

	const added = find_added(snapshot_keys, current)
	const removed = find_removed(current_keys, snapshot)
	const modified = find_modified(snapshot, current)
	const is_changed = added.length > 0 || removed.length > 0 || modified.length > 0

	return { is_changed, added, removed, modified }
}

const SNAPSHOT_PATH = '.overrides-snapshot.json'

function read_overrides_from_package(package_json_content: string): Record<string, string> {
	const parsed = package_pnpm_schema.parse(JSON.parse(package_json_content))

	return parsed.pnpm?.overrides ?? {}
}

function find_version_separator(key: string): number {
	const scope_offset = key.startsWith('@') ? 1 : 0

	return key.indexOf('@', scope_offset)
}

function extract_package_name(key: string): string {
	const separator = find_version_separator(key)

	if (separator === -1) return key

	return key.slice(0, separator)
}

function is_version_cap_override(key: string): boolean {
	const separator = find_version_separator(key)

	if (separator === -1) return false

	const constraint = key.slice(separator + 1)

	return (
		(constraint.startsWith('>=') || constraint.startsWith('>')) &&
		!constraint.includes('<=') &&
		!constraint.includes('<')
	)
}

function extract_capped_package_names(overrides: Record<string, string>): Array<string> {
	return Object.keys(overrides)
		.filter((key) => is_version_cap_override(key))
		.map((key) => extract_package_name(key))
}

function read_dep_names(package_json_content: string): Array<string> {
	const parsed = package_with_deps_schema.parse(JSON.parse(package_json_content))

	return [...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})]
}

function build_update_command(
	overrides: Record<string, string>,
	package_json_content: string,
): string | undefined {
	const capped = extract_capped_package_names(overrides)

	if (capped.length === 0) return 'pnpm update --latest'

	const all_names = read_dep_names(package_json_content)
	const capped_set = new Set(capped)
	const targets = all_names.filter((name) => !capped_set.has(name))

	if (targets.length === 0) return undefined

	return `pnpm update --latest ${targets.join(' ')}`
}

const overrides_check = {
	compare,
	read_overrides_from_package,
	extract_capped_package_names,
	read_dep_names,
	build_update_command,
	SNAPSHOT_PATH,
}

export type { OverridesDiff, AddedEntry, RemovedEntry, ModifiedEntry }
export { overrides_check }
