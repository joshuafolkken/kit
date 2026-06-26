import { config_merge } from '#scripts/config-merge/index'
import { json_object_schema, string_array_schema, string_record_schema } from '#scripts/schemas'
import strip_json_comments from 'strip-json-comments'
import { apply_jf_migrations, remove_retired_scripts } from './init-logic-migrate'
import { PACKAGE_JSON_KEY_ORDER } from './init-logic-package-key-order'

function parse_jsonc(content: string): unknown {
	return JSON.parse(strip_json_comments(content, { trailingCommas: true }))
}

// Ensure `entry` is in the tsconfig `extends` list, preserving every other key. Thin wrapper over
// the shared config-merge library, which normalizes a string-or-array `extends` and prepends the
// new entry — so the ensure semantics are single-sourced with the cspell `import` patch.
function merge_json_extends(content: string, entry: string): string {
	return config_merge.patch_json_list_field(content, { field: 'extends', ensure: [entry] })
}

function extract_compiler_options(content: string): Record<string, unknown> {
	const parsed = json_object_schema.parse(parse_jsonc(content))
	// eslint-disable-next-line dot-notation -- Record<string, unknown> requires bracket notation per noPropertyAccessFromIndexSignature
	const raw = parsed['compilerOptions']
	if (raw === undefined) return {}

	return json_object_schema.parse(raw)
}

// A consumer compilerOptions key is redundant only when its value deep-equals the kit base
// preset's value. Such keys can be dropped without changing the effective config, because the
// SvelteKit-generated tsconfig (the other extends layer) never sets these keys to a different
// value. Value-divergent keys (e.g. a library's noEmitOnError:false) are intentional overrides
// and are preserved — sync cannot tell a necessary override from an unnecessary one.
function is_redundant_option(
	value: unknown,
	key: string,
	base_options: Record<string, unknown>,
): boolean {
	if (!Object.hasOwn(base_options, key)) return false

	return JSON.stringify(base_options[key]) === JSON.stringify(value)
}

function without_compiler_options(parsed: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== 'compilerOptions'))
}

function serialize_stripped(
	parsed: Record<string, unknown>,
	kept: Record<string, unknown>,
): string {
	const next =
		Object.keys(kept).length === 0
			? without_compiler_options(parsed)
			: { ...parsed, compilerOptions: kept }

	return `${JSON.stringify(next, undefined, '\t')}\n`
}

function keep_divergent_options(
	current: Record<string, unknown>,
	base_options: Record<string, unknown>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(current).filter(
			([key, value]) => !is_redundant_option(value, key, base_options),
		),
	)
}

function strip_redundant_compiler_options(
	content: string,
	base_options: Record<string, unknown>,
): string {
	const parsed = json_object_schema.parse(parse_jsonc(content))
	// eslint-disable-next-line dot-notation -- Record<string, unknown> requires bracket notation per noPropertyAccessFromIndexSignature
	const raw = parsed['compilerOptions']
	if (raw === undefined) return content
	const current = json_object_schema.parse(raw)
	const kept = keep_divergent_options(current, base_options)
	if (Object.keys(kept).length === Object.keys(current).length) return content

	return serialize_stripped(parsed, kept)
}

function merge_json_array_field(
	content: string,
	key: string,
	values: ReadonlyArray<string>,
): string {
	const parsed = json_object_schema.parse(parse_jsonc(content))
	const existing = Object.hasOwn(parsed, key) ? string_array_schema.parse(parsed[key]) : []
	const to_add = values.filter((value) => !existing.includes(value))
	if (to_add.length === 0) return content

	return `${JSON.stringify({ ...parsed, [key]: [...existing, ...to_add] }, undefined, '\t')}\n`
}

function merge_json_object(content: string, updates: Record<string, unknown>): string {
	const parsed = json_object_schema.parse(parse_jsonc(content))
	let has_changes = false

	for (const [key, value] of Object.entries(updates)) {
		if (Object.hasOwn(parsed, key)) continue
		parsed[key] = value
		has_changes = true
	}

	if (!has_changes) return content

	return `${JSON.stringify(parsed, undefined, '\t')}\n`
}

const SCRIPTS_PREPEND_KEYS = new Set(['preinstall'])

function merge_package_scripts(content: string, scripts: Record<string, string>): string {
	const parsed = json_object_schema.parse(parse_jsonc(content))
	// eslint-disable-next-line dot-notation -- Record<string, unknown> requires bracket notation per noPropertyAccessFromIndexSignature
	const raw = parsed['scripts']
	const existing = raw === undefined ? {} : string_record_schema.parse(raw)
	const migrated = remove_retired_scripts(apply_jf_migrations(existing))
	const to_add = Object.entries(scripts).filter(([key]) => !Object.hasOwn(migrated, key))
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
	const to_add = Object.entries(additions).filter(([key]) => !Object.hasOwn(existing, key))
	if (to_add.length === 0) return content

	return `${JSON.stringify({ ...parsed, devDependencies: { ...existing, ...Object.fromEntries(to_add) } }, undefined, '\t')}\n`
}

function merge_package_manager(content: string, value: string): string {
	if (value.length === 0) return content
	const parsed = json_object_schema.parse(parse_jsonc(content))
	if ('packageManager' in parsed) return content

	return `${JSON.stringify({ ...parsed, packageManager: value }, undefined, '\t')}\n`
}

function merge_development_engines(content: string, value: Record<string, unknown>): string {
	const parsed = json_object_schema.parse(parse_jsonc(content))
	if ('devEngines' in parsed) return content

	return `${JSON.stringify({ ...parsed, devEngines: value }, undefined, '\t')}\n`
}

function has_package_scripts_marker(content: string, marker: string): boolean {
	const parsed = json_object_schema.parse(parse_jsonc(content))
	// eslint-disable-next-line dot-notation -- Record<string, unknown> requires bracket notation per noPropertyAccessFromIndexSignature
	const raw = parsed['scripts']
	if (raw === undefined) return false
	const scripts = string_record_schema.parse(raw)

	return Object.values(scripts).some((cmd) => cmd.includes(marker))
}

function merge_package_script_suffix(content: string, key: string, cmd: string): string {
	const parsed = json_object_schema.parse(parse_jsonc(content))
	// eslint-disable-next-line dot-notation -- Record<string, unknown> requires bracket notation per noPropertyAccessFromIndexSignature
	const raw = parsed['scripts']
	if (raw === undefined) return content
	const scripts = string_record_schema.parse(raw)
	const existing = scripts[key]
	if (existing === undefined || existing.includes(cmd)) return content
	const updated_value = existing.trim().length === 0 ? cmd : `${existing} && ${cmd}`

	return `${JSON.stringify({ ...parsed, scripts: { ...scripts, [key]: updated_value } }, undefined, '\t')}\n`
}

// Matches a `pnpm <name>` or `pnpm run <name>` delegation to a sibling package script,
// capturing the referenced script name (e.g. `pnpm prepare:gen` → `prepare:gen`). Built-in
// invocations (`pnpm dlx …`, `pnpm install`) capture a token that is not a script key, so the
// resolver simply never follows them. Conservative by design: a reference it cannot parse is
// treated as not-covered rather than guessed at.
const PNPM_SCRIPT_REFERENCE_PATTERN = /\bpnpm\s+(?:run\s+)?([\w:-]+)/gu

function collect_pnpm_script_references(cmd: string): Array<string> {
	return Array.from(cmd.matchAll(PNPM_SCRIPT_REFERENCE_PATTERN), (match) => match[1] ?? '')
}

// Reports whether the script at `key` runs a command containing `marker`, directly or
// transitively via `pnpm <name>` references to sibling scripts. The shared `visited` set
// guards mutually-referential scripts (`a → b → a`) against infinite recursion.
function has_marker_in_script_chain(
	scripts: Record<string, string>,
	key: string,
	marker: string,
	visited: Set<string>,
): boolean {
	if (visited.has(key)) return false
	visited.add(key)
	const cmd = scripts[key]
	if (cmd === undefined) return false
	if (cmd.includes(marker)) return true

	return collect_pnpm_script_references(cmd).some((name) =>
		has_marker_in_script_chain(scripts, name, marker, visited),
	)
}

// True when the `key` script transitively runs `marker`, following `pnpm <name>` references
// through the package's own scripts. Lets a caller skip appending a command the chain already
// covers — e.g. a `prepare` that reaches `wrangler types` via a `pnpm <subscript>` chain.
function has_script_marker_coverage(content: string, key: string, marker: string): boolean {
	const parsed = json_object_schema.parse(parse_jsonc(content))
	// eslint-disable-next-line dot-notation -- Record<string, unknown> requires bracket notation per noPropertyAccessFromIndexSignature
	const raw = parsed['scripts']
	if (raw === undefined) return false
	const scripts = string_record_schema.parse(raw)

	return has_marker_in_script_chain(scripts, key, marker, new Set())
}

const SCRIPT_COMMAND_SEPARATOR = ' && '
// Bare `&&` operator. Splitting on the literal (then trimming each segment) matches a
// command regardless of how the consumer spaced its pipeline (`a&&b`, `a  &&  b`) without
// a `\s*…\s*` regex that static analysis flags as backtracking-prone.
const SCRIPT_COMMAND_AND = '&&'

// Drop every `&&`-joined segment of a script whose trimmed command matches `pattern`,
// then rejoin the survivors with a normalized ` && `. Used to migrate a one-off command
// (e.g. `wrangler types`) out of a `build` pipeline once another lifecycle hook owns it.
// Returns content unchanged (original formatting preserved) when the key is absent or no
// segment matches, so idempotent re-runs and non-target scripts are never rewritten.
function remove_script_command_segment(content: string, key: string, pattern: RegExp): string {
	const parsed = json_object_schema.parse(parse_jsonc(content))
	// eslint-disable-next-line dot-notation -- Record<string, unknown> requires bracket notation per noPropertyAccessFromIndexSignature
	const raw = parsed['scripts']
	if (raw === undefined) return content
	const scripts = string_record_schema.parse(raw)
	const existing = scripts[key]
	if (existing === undefined) return content
	const segments = existing.split(SCRIPT_COMMAND_AND).map((segment) => segment.trim())
	const kept = segments.filter((segment) => segment.length > 0 && !pattern.test(segment))
	if (kept.length === segments.length) return content

	return `${JSON.stringify({ ...parsed, scripts: { ...scripts, [key]: kept.join(SCRIPT_COMMAND_SEPARATOR) } }, undefined, '\t')}\n`
}

function remove_script_with_marker(content: string, key: string, marker: string): string {
	const parsed = json_object_schema.parse(parse_jsonc(content))
	// eslint-disable-next-line dot-notation -- Record<string, unknown> requires bracket notation per noPropertyAccessFromIndexSignature
	const raw = parsed['scripts']
	if (raw === undefined) return content
	const scripts = string_record_schema.parse(raw)
	if (!scripts[key]?.includes(marker)) return content
	const rest = Object.fromEntries(Object.entries(scripts).filter(([k]) => k !== key))

	return `${JSON.stringify({ ...parsed, scripts: rest }, undefined, '\t')}\n`
}

function sort_package_json_keys(content: string): string {
	const parsed = json_object_schema.parse(parse_jsonc(content))
	const all_keys = Object.keys(parsed)
	const known = PACKAGE_JSON_KEY_ORDER.filter((k) => Object.hasOwn(parsed, k))
	const unknown = all_keys.filter((k) => !PACKAGE_JSON_KEY_ORDER.includes(k))
	const ordered = Object.fromEntries([...known, ...unknown].map((k) => [k, parsed[k]]))
	const serialized = `${JSON.stringify(ordered, undefined, '\t')}\n`
	const current = `${JSON.stringify(parsed, undefined, '\t')}\n`
	if (serialized === current) return content

	return serialized
}

const init_logic_json_merge = {
	merge_json_extends,
	extract_compiler_options,
	strip_redundant_compiler_options,
	merge_json_array_field,
	merge_json_object,
	merge_package_scripts,
	merge_package_script_suffix,
	has_script_marker_coverage,
	remove_script_command_segment,
	remove_script_with_marker,
	has_package_scripts_marker,
	merge_development_dependencies,
	merge_package_manager,
	merge_development_engines,
	sort_package_json_keys,
}

export { init_logic_json_merge }
