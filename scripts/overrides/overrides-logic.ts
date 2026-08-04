import { yaml_document } from '#scripts/yaml-document'
import {
	package_pnpm_schema,
	package_with_deps_schema,
	workspace_overrides_schema,
} from './schemas'

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
		.filter(([key]) => Object.hasOwn(current, key) && snapshot[key] !== current[key])
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
const PACKAGE_JSON_PATH = 'package.json'
const WORKSPACE_YAML_PATH = 'pnpm-workspace.yaml'

// Both source files are optional and either may be absent from a project entirely, so an empty
// string stands for "file not present" rather than being an error.
interface OverridesSources {
	package_json: string
	workspace_yaml: string
}

function read_overrides_from_package(package_json_content: string): Record<string, string> {
	if (package_json_content.trim().length === 0) return {}
	const parsed = package_pnpm_schema.parse(JSON.parse(package_json_content))

	return parsed.pnpm?.overrides ?? {}
}

function read_overrides_from_workspace(workspace_yaml_content: string): Record<string, string> {
	const parsed = workspace_overrides_schema.parse(yaml_document.parse_yaml(workspace_yaml_content))

	return parsed.overrides ?? {}
}

// Under pnpm 11 overrides live in pnpm-workspace.yaml; `pnpm.overrides` in package.json is the
// legacy location and a project may use either. Reading only one of them is how a protection check
// reports "no overrides to protect" while a real override sits in the file it never opened
// (kit #740), so every caller goes through this merged reader. Workspace entries win on a key
// collision, matching pnpm's own precedence for workspace-level settings.
function read_overrides(sources: OverridesSources): Record<string, string> {
	return {
		...read_overrides_from_package(sources.package_json),
		...read_overrides_from_workspace(sources.workspace_yaml),
	}
}

function count_entry(path: string, overrides: Record<string, string>): Array<string> {
	const count = Object.keys(overrides).length

	return count === 0 ? [] : [`${String(count)} from ${path}`]
}

// Printed next to every verdict so a vacuous run is visible: "no overrides found in …" names the
// files that were actually read, which is the signal missing when the check passed on an empty
// `package.json` while pnpm-workspace.yaml held the real entries.
function describe_sources(sources: OverridesSources): string {
	const counts = [
		...count_entry(WORKSPACE_YAML_PATH, read_overrides_from_workspace(sources.workspace_yaml)),
		...count_entry(PACKAGE_JSON_PATH, read_overrides_from_package(sources.package_json)),
	]

	if (counts.length === 0) {
		return `no overrides found in ${WORKSPACE_YAML_PATH} or ${PACKAGE_JSON_PATH}`
	}

	return counts.join(', ')
}

function format_diff_lines(diff: OverridesDiff): Array<string> {
	return [
		...diff.added.map((entry) => `  + added:   ${entry.key} → ${entry.value}`),
		...diff.removed.map((entry) => `  - removed: ${entry.key} (was ${entry.value})`),
		...diff.modified.map(
			(entry) => `  ~ changed: ${entry.key}: ${entry.old_value} → ${entry.new_value}`,
		),
	]
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

// Every overridden package, whether the key carries a version selector (`pkg@>=5`) or not
// (`pkg: ^5.55.7`). An override declares the resolution the project has chosen for that package, so
// `pnpm update --latest` must not rewrite its declared range: past a cap the tree stops resolving,
// and for a plain override pnpm writes the raw package.json range into the lockfile importer instead
// of the override-applied one, producing a lockfile that fails CI's frozen-lockfile install
// (kit #744). Both failures have the same cause, so both take the same exclusion.
function extract_overridden_package_names(overrides: Record<string, string>): Array<string> {
	return Object.keys(overrides).map((key) => extract_package_name(key))
}

// Packages always held back from `pnpm update --latest`, regardless of overrides.
// `typescript`: 7.x is the native (Go) port whose `require('typescript')` returns a stub with no
// `SyntaxKind`, crashing the type-aware ESLint stack (typescript-eslint, eslint-plugin-sonarjs,
// ts-api-utils) at rule-load time. Hold at 6.x until that stack supports the native API, then
// remove this entry to fix forward (kit #658).
const HELD_BACK_PACKAGE_NAMES: Array<string> = ['typescript']

// The union of built-in held-back packages and every overridden package — the dependency names
// `pnpm update --latest` must skip. Deduped so a package that is both held back and overridden is
// listed once (used both to build the update command and to log what was skipped).
function list_excluded_package_names(overrides: Record<string, string>): Array<string> {
	return [...new Set([...HELD_BACK_PACKAGE_NAMES, ...extract_overridden_package_names(overrides)])]
}

function read_dependency_names(package_json_content: string): Array<string> {
	const parsed = package_with_deps_schema.parse(JSON.parse(package_json_content))

	return [...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})]
}

const PNPM_UPDATE_LATEST_ARGS = ['pnpm', 'update', '--latest']

function build_update_command(
	overrides: Record<string, string>,
	package_json_content: string,
): Array<string> | undefined {
	const excluded_set = new Set(list_excluded_package_names(overrides))
	const all_names = read_dependency_names(package_json_content)
	const targets = all_names.filter((name) => !excluded_set.has(name))

	if (targets.length === 0) return undefined

	return [...PNPM_UPDATE_LATEST_ARGS, ...targets]
}

const overrides_check = {
	compare,
	read_overrides_from_package,
	read_overrides_from_workspace,
	read_overrides,
	describe_sources,
	format_diff_lines,
	extract_package_name,
	extract_overridden_package_names,
	list_excluded_package_names,
	read_dependency_names,
	build_update_command,
	PACKAGE_JSON_PATH,
	WORKSPACE_YAML_PATH,
	SNAPSHOT_PATH,
}

export type { OverridesDiff, AddedEntry, RemovedEntry, ModifiedEntry, OverridesSources }
export { overrides_check }
