import { json_object_schema, string_array_schema } from '#scripts/schemas'
import { dump, load, YAMLException, type DumpOptions } from 'js-yaml'
import { list_patch, type ListEntryMatcher } from './list-patch'

// Where a newly-created list field is placed when the field is absent. Existing fields are always
// rewritten in place, preserving their position among the other keys.
//   - 'front'        : the field becomes the first key (lefthook `extends` precedent)
//   - 'end'          : the field is appended after all existing keys
//   - { after: key } : inserted right after `key`, falling back to 'end' when `key` is absent
//                      (cspell `import` precedent: placed after `version`)
type YamlFieldPosition = 'front' | 'end' | { after: string }

interface PatchYamlListOptions {
	field: string
	ensure?: ReadonlyArray<string>
	remove?: ReadonlyArray<ListEntryMatcher>
	position?: YamlFieldPosition
	// Scalar quote style passed through to js-yaml `dump`, so a caller (cspell) can match the
	// VSCode extension's double-quoted output. Omit for js-yaml's default quoting.
	quote_style?: DumpOptions['quoteStyle']
}

// js-yaml 5 throws "expected a document, but the input is empty" for input with no document node
// (empty / whitespace / comment-only), whereas js-yaml 4 returned undefined. Restore the v4
// semantics so patching an empty or comment-only file yields {} instead of throwing.
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

function read_yaml_list_field(content: string, field: string): ReadonlyArray<string> {
	const raw = parse_yaml(content)[field]

	return Array.isArray(raw) ? string_array_schema.parse(raw) : []
}

function replace_field(
	parsed: Record<string, unknown>,
	field: string,
	value: ReadonlyArray<string>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(parsed).map(([key, entry]) => [key, key === field ? [...value] : entry]),
	)
}

function insert_after(
	parsed: Record<string, unknown>,
	field: string,
	value: ReadonlyArray<string>,
	anchor: string,
): Record<string, unknown> {
	const entries = Object.entries(parsed)
	const index = entries.findIndex(([key]) => key === anchor)
	if (index === -1) return { ...parsed, [field]: [...value] }

	return Object.fromEntries([
		...entries.slice(0, index + 1),
		[field, [...value]],
		...entries.slice(index + 1),
	])
}

function insert_new_field(
	parsed: Record<string, unknown>,
	field: string,
	value: ReadonlyArray<string>,
	position: YamlFieldPosition,
): Record<string, unknown> {
	if (position === 'front') return { [field]: [...value], ...parsed }
	if (position === 'end') return { ...parsed, [field]: [...value] }

	return insert_after(parsed, field, value, position.after)
}

function place_field(
	parsed: Record<string, unknown>,
	field: string,
	value: ReadonlyArray<string>,
	position: YamlFieldPosition,
): Record<string, unknown> {
	if (Object.hasOwn(parsed, field)) return replace_field(parsed, field, value)

	return insert_new_field(parsed, field, value, position)
}

// Ensure/remove the entries of one YAML list field, preserving every other key and value. Returns
// the input unchanged (comments and formatting intact) when nothing is added or removed, which
// also makes re-runs idempotent. Comments are otherwise dropped — see the value-only decision.
function patch_yaml_list_field(content: string, options: PatchYamlListOptions): string {
	const parsed = parse_yaml(content)
	const existing = read_yaml_list_field(content, options.field)
	const { next, is_changed } = list_patch.apply_list_patch(existing, options)
	if (!is_changed) return content

	const placed = place_field(parsed, options.field, next, options.position ?? 'front')

	return dump(placed, options.quote_style === undefined ? {} : { quoteStyle: options.quote_style })
}

const yaml_list = {
	patch_yaml_list_field,
	read_yaml_list_field,
}

export type { PatchYamlListOptions, YamlFieldPosition }
export { yaml_list }
