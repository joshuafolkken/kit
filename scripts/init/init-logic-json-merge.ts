import { config_merge } from '#scripts/config-merge/index'
import { json_format } from '#scripts/config-merge/json-format'
import { parse_jsonc } from '#scripts/config-merge/parse-jsonc'
import { patch_json_key } from '#scripts/config-merge/patch-json-key'
import { json_object_schema, string_array_schema, string_record_schema } from '#scripts/schemas'
import { apply_jf_migrations, remove_retired_scripts } from './init-logic-migrate'
import { PACKAGE_JSON_KEY_ORDER } from './init-logic-package-key-order'
import { kit_base_preset } from './kit-base-preset'
import { EXTENDS_FIELD, tsconfig_preset_migration } from './tsconfig-preset-migration'

// Ensure `entry` is in the tsconfig `extends` list, preserving every other key. Thin wrapper over
// the shared config-merge library, which normalizes a string-or-array `extends` and prepends the
// new entry — so the ensure semantics are single-sourced with the cspell `import` patch.
function merge_json_extends(content: string, entry: string): string {
	return config_merge.patch_json_list_field(content, { field: EXTENDS_FIELD, ensure: [entry] })
}

// Normalize the tsconfig `extends` (a string, an array, or absent) to a plain string array so the
// ecosystem-preset check reads the same shape regardless of how the consumer authored it.
function read_extends_entries(content: string): ReadonlyArray<string> {
	const raw = parse_jsonc(content)[EXTENDS_FIELD]
	if (typeof raw === 'string') return [raw]
	if (Array.isArray(raw)) return string_array_schema.parse(raw)

	return []
}

// Ensure kit's tsconfig base preset is in `extends` — UNLESS an `@joshuafolkken/*` tsconfig preset
// (kit's own base, or an app-kit / game-kit framework preset that already embeds kit base) is
// present. Adding kit's base alongside such a preset is a redundant second extend. See
// joshuafolkken/kit#660. The legacy `.jsonc` preset extension is migrated first: the presence check
// below matches it too, so without the rewrite a consumer stuck on the old path would be reported
// "already present" and never repaired. `base_directory` is the project root the `extends` paths
// resolve against, which the migration needs to confirm the renamed preset is installed. See
// joshuafolkken/kit#681.
function merge_tsconfig_extends(content: string, entry: string, base_directory: string): string {
	const migrated = tsconfig_preset_migration.migrate_preset_paths(content, base_directory)
	if (kit_base_preset.is_tsconfig_base_present(read_extends_entries(migrated))) return migrated

	return merge_json_extends(migrated, entry)
}

function extract_compiler_options(content: string): Record<string, unknown> {
	const parsed = parse_jsonc(content)
	// eslint-disable-next-line dot-notation -- Record<string, unknown> requires bracket notation per noPropertyAccessFromIndexSignature
	const raw = parsed['compilerOptions']
	if (raw === undefined) return {}

	return json_object_schema.parse(raw)
}

// A consumer compilerOptions key is redundant only when its value deep-equals the kit base
// preset's value. Such keys can be dropped without changing the effective config, because any
// other extends layer the consumer adds never sets these keys to a different value. Value-divergent
// keys (e.g. a library's noEmitOnError:false) are intentional overrides and are preserved — sync
// cannot tell a necessary override from an unnecessary one.
function is_redundant_option(
	value: unknown,
	key: string,
	base_options: Record<string, unknown>,
): boolean {
	if (!Object.hasOwn(base_options, key)) return false

	return JSON.stringify(base_options[key]) === JSON.stringify(value)
}

const COMPILER_OPTIONS_FIELD = 'compilerOptions'

// Prune the redundant options one at a time, in place. Setting `compilerOptions` to the kept subset
// would be one edit instead of several, but it replaces the whole block and takes any comment the
// consumer wrote inside it along with the options being dropped (joshuafolkken/kit#798). Each
// removal re-reads the document, so the shifting offsets take care of themselves.
function drop_redundant_options(content: string, redundant: ReadonlyArray<string>): string {
	let current = content

	for (const key of redundant) {
		current = patch_json_key.remove_json_path(current, [COMPILER_OPTIONS_FIELD, key])
	}

	return current
}

function serialize_stripped(
	content: string,
	kept: Record<string, unknown>,
	redundant: ReadonlyArray<string>,
): string {
	if (Object.keys(kept).length === 0) {
		return patch_json_key.remove_json_key(content, COMPILER_OPTIONS_FIELD)
	}

	return drop_redundant_options(content, redundant)
}

function redundant_option_keys(
	current: Record<string, unknown>,
	base_options: Record<string, unknown>,
): Array<string> {
	return Object.entries(current)
		.filter(([key, value]) => is_redundant_option(value, key, base_options))
		.map(([key]) => key)
}

function strip_redundant_compiler_options(
	content: string,
	base_options: Record<string, unknown>,
): string {
	const raw = parse_jsonc(content)[COMPILER_OPTIONS_FIELD]
	if (raw === undefined) return content
	const current = json_object_schema.parse(raw)
	const redundant = redundant_option_keys(current, base_options)
	if (redundant.length === 0) return content
	const kept = Object.entries(current).filter(([key]) => !redundant.includes(key))

	return serialize_stripped(content, Object.fromEntries(kept), redundant)
}

function merge_json_array_field(
	content: string,
	key: string,
	values: ReadonlyArray<string>,
): string {
	const parsed = parse_jsonc(content)
	const existing = Object.hasOwn(parsed, key) ? string_array_schema.parse(parsed[key]) : []
	const to_add = values.filter((value) => !existing.includes(value))
	if (to_add.length === 0) return content

	return patch_json_key.set_json_key(content, key, [...existing, ...to_add])
}

// The entries of `additions` the `existing` record does not already own. Every merge in this module
// is create-only at its own granularity — kit adds what is absent and never rewrites what the
// consumer declared — so the "which keys are missing" question is asked once here rather than being
// re-spelled at each call site.
function missing_entries<T>(
	existing: Record<string, unknown>,
	additions: Record<string, T>,
): Array<[string, T]> {
	return Object.entries(additions).filter(([key]) => !Object.hasOwn(existing, key))
}

// Merge kit's value for a key the consumer already owns, returning `undefined` when the key must be
// left exactly as authored. Object-valued settings are registries of independent entries (VSCode's
// `files.associations` is the motivating one), so kit's missing entries are added while every entry
// the consumer already has wins — the same ensure semantics config_merge applies to the cspell
// `import` and tsconfig `extends` lists. Arrays and scalars stay untouched: combining a list such as
// `eslint.validate` would be a guess about intent, and overwriting it would drop the consumer's own
// entries. Without this, one customized key froze out every later kit addition inside it, silently.
// See joshuafolkken/kit#691.
function merge_owned_entries(current: unknown, update: unknown): unknown {
	const current_object = json_object_schema.safeParse(current)
	const update_object = json_object_schema.safeParse(update)
	if (!current_object.success || !update_object.success) return undefined

	const owned = current_object.data
	const missing = missing_entries(owned, update_object.data)
	if (missing.length === 0) return undefined

	return { ...owned, ...Object.fromEntries(missing) }
}

// The subset of `updates` that actually changes the file: a key the consumer lacks is taken whole,
// a key it owns goes through the entry merge, and `undefined` (leave as authored) is dropped.
function collect_applicable_updates(
	parsed: Record<string, unknown>,
	updates: Record<string, unknown>,
): Record<string, unknown> {
	const resolved = Object.entries(updates).map(([key, value]): [string, unknown] => [
		key,
		Object.hasOwn(parsed, key) ? merge_owned_entries(parsed[key], value) : value,
	])

	return Object.fromEntries(resolved.filter(([, merged]) => merged !== undefined))
}

// One key at a time rather than one whole-file rewrite: each `set_json_key` leaves every byte
// outside its own value untouched, so a consumer's comments survive a merge that only adds keys.
function merge_json_object(content: string, updates: Record<string, unknown>): string {
	const parsed = parse_jsonc(content)
	const applicable = collect_applicable_updates(parsed, updates)
	if (Object.keys(applicable).length === 0) return content

	let current = content

	for (const [key, value] of Object.entries(applicable)) {
		current = patch_json_key.set_json_key(current, key, value)
	}

	return current
}

// Every writer below this line targets `package.json`, which prettier formats with the
// `json-stringify` parser rather than `json` — arrays stay one element per line there, whatever
// their width. Routing them through one named helper keeps that distinction visible at each call
// site: a new package.json writer copied from a sibling inherits the right serializer, and one that
// reaches for `json_format.format_json` instead is the mistake kit#797 was. Everything ABOVE writes
// `tsconfig.json` / `.vscode/*.json`, where `format_json`'s array inlining is what prettier wants.
function serialize_package_json(value: Record<string, unknown>): string {
	return json_format.format_package_json(value)
}

const SCRIPTS_PREPEND_KEYS = new Set(['preinstall'])

function merge_package_scripts(content: string, scripts: Record<string, string>): string {
	const parsed = parse_jsonc(content)
	// eslint-disable-next-line dot-notation -- Record<string, unknown> requires bracket notation per noPropertyAccessFromIndexSignature
	const raw = parsed['scripts']
	const existing = raw === undefined ? {} : string_record_schema.parse(raw)
	const migrated = remove_retired_scripts(apply_jf_migrations(existing))
	const to_add = missing_entries(migrated, scripts)
	const did_migrate = JSON.stringify(migrated) !== JSON.stringify(existing)

	if (!did_migrate && to_add.length === 0) return content

	const prepend = Object.fromEntries(to_add.filter(([k]) => SCRIPTS_PREPEND_KEYS.has(k)))
	const append = Object.fromEntries(to_add.filter(([k]) => !SCRIPTS_PREPEND_KEYS.has(k)))

	return serialize_package_json({ ...parsed, scripts: { ...prepend, ...migrated, ...append } })
}

function merge_development_dependencies(
	content: string,
	additions: Record<string, string>,
): string {
	const parsed = parse_jsonc(content)
	// eslint-disable-next-line dot-notation -- Record<string, unknown> requires bracket notation per noPropertyAccessFromIndexSignature
	const raw = parsed['devDependencies']
	const existing = raw === undefined ? {} : string_record_schema.parse(raw)
	const to_add = missing_entries(existing, additions)
	if (to_add.length === 0) return content

	return serialize_package_json({
		...parsed,
		devDependencies: { ...existing, ...Object.fromEntries(to_add) },
	})
}

function merge_package_manager(content: string, value: string): string {
	if (value.length === 0) return content
	const parsed = parse_jsonc(content)
	if ('packageManager' in parsed) return content

	return serialize_package_json({ ...parsed, packageManager: value })
}

function merge_development_engines(content: string, value: Record<string, unknown>): string {
	const parsed = parse_jsonc(content)
	if ('devEngines' in parsed) return content

	return serialize_package_json({ ...parsed, devEngines: value })
}

function has_package_scripts_marker(content: string, marker: string): boolean {
	const parsed = parse_jsonc(content)
	// eslint-disable-next-line dot-notation -- Record<string, unknown> requires bracket notation per noPropertyAccessFromIndexSignature
	const raw = parsed['scripts']
	if (raw === undefined) return false
	const scripts = string_record_schema.parse(raw)

	return Object.values(scripts).some((cmd) => cmd.includes(marker))
}

function merge_package_script_suffix(content: string, key: string, cmd: string): string {
	const parsed = parse_jsonc(content)
	// eslint-disable-next-line dot-notation -- Record<string, unknown> requires bracket notation per noPropertyAccessFromIndexSignature
	const raw = parsed['scripts']
	if (raw === undefined) return content
	const scripts = string_record_schema.parse(raw)
	const existing = scripts[key]
	if (existing === undefined || existing.includes(cmd)) return content
	const updated_value = existing.trim().length === 0 ? cmd : `${existing} && ${cmd}`

	return serialize_package_json({ ...parsed, scripts: { ...scripts, [key]: updated_value } })
}

function remove_script_with_marker(content: string, key: string, marker: string): string {
	const parsed = parse_jsonc(content)
	// eslint-disable-next-line dot-notation -- Record<string, unknown> requires bracket notation per noPropertyAccessFromIndexSignature
	const raw = parsed['scripts']
	if (raw === undefined) return content
	const scripts = string_record_schema.parse(raw)
	if (!scripts[key]?.includes(marker)) return content
	const rest = Object.fromEntries(Object.entries(scripts).filter(([k]) => k !== key))

	return serialize_package_json({ ...parsed, scripts: rest })
}

// Deliberately compares two serializations of the same parsed object, so only a KEY ORDER change
// rewrites the file. That makes the kit#797 fix forward-only: a package.json an older kit already
// inlined is not healed, because formatting-only drift on disk is invisible here. Comparing
// `serialized` against raw `content` instead would heal it, and would also rewrite any manifest
// whose indentation merely differs from kit's tabs — a much wider claim over a file kit does not own.
// No consumer was found in that damaged state when the fix landed, so the narrow behavior wins; a
// project that does hit it is repaired by one `prettier --write package.json`.
function sort_package_json_keys(content: string): string {
	const parsed = parse_jsonc(content)
	const all_keys = Object.keys(parsed)
	const known = PACKAGE_JSON_KEY_ORDER.filter((k) => Object.hasOwn(parsed, k))
	const unknown = all_keys.filter((k) => !PACKAGE_JSON_KEY_ORDER.includes(k))
	const ordered = Object.fromEntries([...known, ...unknown].map((k) => [k, parsed[k]]))
	const serialized = serialize_package_json(ordered)
	const current = serialize_package_json(parsed)
	if (serialized === current) return content

	return serialized
}

const init_logic_json_merge = {
	merge_json_extends,
	merge_tsconfig_extends,
	extract_compiler_options,
	strip_redundant_compiler_options,
	merge_json_array_field,
	merge_json_object,
	merge_package_scripts,
	merge_package_script_suffix,
	remove_script_with_marker,
	has_package_scripts_marker,
	merge_development_dependencies,
	merge_package_manager,
	merge_development_engines,
	sort_package_json_keys,
}

export { init_logic_json_merge }
