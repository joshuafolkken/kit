import { dump, load } from 'js-yaml'
import strip_json_comments from 'strip-json-comments'
import { apply_jf_migrations, remove_retired_scripts } from './init-logic-migrate'
import {
	json_object_schema,
	string_array_schema,
	string_record_schema,
	with_extends_schema,
} from './schemas'

const PACKAGE_JSON_KEY_ORDER: ReadonlyArray<string> = [
	'name',
	'version',
	'description',
	'keywords',
	'homepage',
	'bugs',
	'license',
	'author',
	'contributors',
	'funding',
	'files',
	'main',
	'browser',
	'exports',
	'imports',
	'bin',
	'man',
	'directories',
	'repository',
	'type',
	'types',
	'typings',
	'typesVersions',
	'publishConfig',
	'private',
	'scripts',
	'config',
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'peerDependenciesMeta',
	'bundleDependencies',
	'bundledDependencies',
	'optionalDependencies',
	'overrides',
	'resolutions',
	'packageManager',
	'engines',
	'os',
	'cpu',
	'size-limit',
	'pnpm',
]

function parse_jsonc(content: string): unknown {
	return JSON.parse(strip_json_comments(content, { trailingCommas: true }))
}

function normalize_extends(value: string | Array<string> | undefined): Array<string> {
	if (value === undefined) return []
	if (typeof value === 'string') return [value]

	return [...value]
}

function merge_json_extends(content: string, entry: string): string {
	const parsed = with_extends_schema.parse(parse_jsonc(content))
	const existing = normalize_extends(parsed.extends)
	if (existing.includes(entry)) return content

	return `${JSON.stringify({ ...parsed, extends: [entry, ...existing] }, undefined, '\t')}\n`
}

function merge_json_array_field(
	content: string,
	key: string,
	values: ReadonlyArray<string>,
): string {
	const parsed = json_object_schema.parse(parse_jsonc(content))
	const existing = key in parsed ? string_array_schema.parse(parsed[key]) : []
	const to_add = values.filter((value) => !existing.includes(value))
	if (to_add.length === 0) return content

	return `${JSON.stringify({ ...parsed, [key]: [...existing, ...to_add] }, undefined, '\t')}\n`
}

function merge_json_object(content: string, updates: Record<string, unknown>): string {
	const parsed = json_object_schema.parse(parse_jsonc(content))
	let has_changes = false

	for (const [key, value] of Object.entries(updates)) {
		if (!(key in parsed)) {
			parsed[key] = value
			has_changes = true
		}
	}

	if (!has_changes) return content

	return `${JSON.stringify(parsed, undefined, '\t')}\n`
}

function parse_yaml(content: string): Record<string, unknown> {
	const raw = load(content)
	if (raw === null || raw === undefined) return {}

	return json_object_schema.parse(raw)
}

function merge_yaml_list_entry(content: string, key: string, value: string): string {
	const parsed = parse_yaml(content)
	const existing_raw = parsed[key]
	const existing = Array.isArray(existing_raw) ? string_array_schema.parse(existing_raw) : []
	if (existing.includes(value)) return content
	if (!(key in parsed)) return dump({ [key]: [value], ...parsed })

	return dump(
		Object.fromEntries(
			Object.entries(parsed).map(([k, entry_value]) => [
				k,
				k === key ? [value, ...existing] : entry_value,
			]),
		),
	)
}

function insert_import_after_version(
	parsed: Record<string, unknown>,
	list: Array<string>,
): Record<string, unknown> {
	const entries = Object.entries(parsed)
	const version_index = entries.findIndex(([k]) => k === 'version')
	if (version_index === -1) return { ...parsed, import: list }

	return Object.fromEntries([
		...entries.slice(0, version_index + 1),
		['import', list],
		...entries.slice(version_index + 1),
	])
}

function merge_cspell_import(content: string, value: string): string {
	const parsed = parse_yaml(content)
	// eslint-disable-next-line dot-notation -- 'import' from index signature requires bracket notation per noPropertyAccessFromIndexSignature
	const existing_raw = parsed['import']
	const existing = Array.isArray(existing_raw) ? string_array_schema.parse(existing_raw) : []
	if (existing.includes(value)) return content

	const updated_list = [value, ...existing]

	if ('import' in parsed) {
		return dump(
			Object.fromEntries(
				Object.entries(parsed).map(([k, entry_value]) => [
					k,
					k === 'import' ? updated_list : entry_value,
				]),
			),
		)
	}

	return dump(insert_import_after_version(parsed, updated_list))
}

const SCRIPTS_PREPEND_KEYS = new Set(['preinstall'])

function merge_package_scripts(content: string, scripts: Record<string, string>): string {
	const parsed = json_object_schema.parse(parse_jsonc(content))
	// eslint-disable-next-line dot-notation -- Record<string, unknown> requires bracket notation per noPropertyAccessFromIndexSignature
	const raw = parsed['scripts']
	const existing = raw === undefined ? {} : string_record_schema.parse(raw)
	const migrated = remove_retired_scripts(apply_jf_migrations(existing))
	const to_add = Object.entries(scripts).filter(([key]) => !(key in migrated))
	const did_migrate = JSON.stringify(migrated) !== JSON.stringify(existing)

	if (!did_migrate && to_add.length === 0) return content

	const prepend = Object.fromEntries(to_add.filter(([k]) => SCRIPTS_PREPEND_KEYS.has(k)))
	const append = Object.fromEntries(to_add.filter(([k]) => !SCRIPTS_PREPEND_KEYS.has(k)))

	return `${JSON.stringify({ ...parsed, scripts: { ...prepend, ...migrated, ...append } }, undefined, '\t')}\n`
}

function merge_development_dependencies(
	content: string,
	additions: Record<string, string>,
): string {
	const parsed = json_object_schema.parse(parse_jsonc(content))
	// eslint-disable-next-line dot-notation -- Record<string, unknown> requires bracket notation per noPropertyAccessFromIndexSignature
	const raw = parsed['devDependencies']
	const existing = raw === undefined ? {} : string_record_schema.parse(raw)
	const to_add = Object.entries(additions).filter(([key]) => !(key in existing))
	if (to_add.length === 0) return content

	return `${JSON.stringify({ ...parsed, devDependencies: { ...existing, ...Object.fromEntries(to_add) } }, undefined, '\t')}\n`
}

function merge_package_manager(content: string, value: string): string {
	if (value.length === 0) return content
	const parsed = json_object_schema.parse(parse_jsonc(content))
	if ('packageManager' in parsed) return content

	return `${JSON.stringify({ ...parsed, packageManager: value }, undefined, '\t')}\n`
}

function sort_package_json_keys(content: string): string {
	const parsed = json_object_schema.parse(parse_jsonc(content))
	const all_keys = Object.keys(parsed)
	const known = PACKAGE_JSON_KEY_ORDER.filter((k) => k in parsed)
	const unknown = all_keys.filter((k) => !PACKAGE_JSON_KEY_ORDER.includes(k))
	const ordered = Object.fromEntries([...known, ...unknown].map((k) => [k, parsed[k]]))
	const serialized = `${JSON.stringify(ordered, undefined, '\t')}\n`
	const current = `${JSON.stringify(parsed, undefined, '\t')}\n`
	if (serialized === current) return content

	return serialized
}

const init_logic_json_merge = {
	merge_json_extends,
	merge_json_array_field,
	merge_json_object,
	merge_yaml_list_entry,
	merge_cspell_import,
	merge_package_scripts,
	merge_development_dependencies,
	merge_package_manager,
	sort_package_json_keys,
}

export { init_logic_json_merge }
