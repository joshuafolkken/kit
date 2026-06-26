import { json_object_schema, string_array_schema } from '#scripts/schemas'
import { dump, load, YAMLException, type DumpOptions } from 'js-yaml'

// Emit double-quoted scalars for cspell config so the serialized output matches what the
// VSCode cspell extension writes, avoiding single/double quote churn when both tools touch
// the file. Scoped to cspell only — lefthook merge keeps js-yaml's default quoting.
const CSPELL_DUMP_OPTIONS: DumpOptions = { quoteStyle: 'double' }

// js-yaml 5 throws "expected a document, but the input is empty" for input with no document
// node (empty / whitespace / comment-only), whereas js-yaml 4 returned undefined. Restore the
// v4 semantics so merging into an empty or comment-only file yields {} instead of throwing.
const EMPTY_YAML_REASON = 'expected a document, but the input is empty'

function load_yaml_or_empty(content: string): unknown {
	try {
		return load(content)
	} catch (error) {
		if (error instanceof YAMLException && error.reason === EMPTY_YAML_REASON) return {}
		throw error
	}
}

function parse_yaml(content: string): Record<string, unknown> {
	const raw = load_yaml_or_empty(content)
	if (raw === null || raw === undefined) return {}

	return json_object_schema.parse(raw)
}

function merge_yaml_list_entry(content: string, key: string, value: string): string {
	const parsed = parse_yaml(content)
	const existing_raw = parsed[key]
	const existing = Array.isArray(existing_raw) ? string_array_schema.parse(existing_raw) : []
	if (existing.includes(value)) return content
	if (!Object.hasOwn(parsed, key)) return dump({ [key]: [value], ...parsed })

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

// Maps a base cspell import to the imports that already provide it transitively. When
// a superseding import is present, the base import is redundant and must not be added.
// kit only string-matches the game import name here; it does not depend on game-kit.
const CSPELL_SUPERSEDING_IMPORTS: ReadonlyArray<{
	base: string
	superseded_by: ReadonlyArray<string>
}> = [
	{
		base: '@joshuafolkken/kit/cspell/sveltekit',
		superseded_by: ['@joshuafolkken/game-kit/cspell/game'],
	},
]

function is_cspell_import_superseded(value: string, existing: ReadonlyArray<string>): boolean {
	const rule = CSPELL_SUPERSEDING_IMPORTS.find((entry) => entry.base === value)
	if (rule === undefined) return false

	return rule.superseded_by.some((entry) => existing.includes(entry))
}

function merge_cspell_import(content: string, value: string): string {
	const parsed = parse_yaml(content)
	// eslint-disable-next-line dot-notation -- 'import' from index signature requires bracket notation per noPropertyAccessFromIndexSignature
	const existing_raw = parsed['import']
	const existing = Array.isArray(existing_raw) ? string_array_schema.parse(existing_raw) : []
	if (existing.includes(value)) return content
	if (is_cspell_import_superseded(value, existing)) return content

	const updated_list = [value, ...existing]

	if ('import' in parsed) {
		return dump(
			Object.fromEntries(
				Object.entries(parsed).map(([k, entry_value]) => [
					k,
					k === 'import' ? updated_list : entry_value,
				]),
			),
			CSPELL_DUMP_OPTIONS,
		)
	}

	return dump(insert_import_after_version(parsed, updated_list), CSPELL_DUMP_OPTIONS)
}

const init_logic_yaml_merge = {
	merge_yaml_list_entry,
	merge_cspell_import,
}

export { init_logic_yaml_merge }
