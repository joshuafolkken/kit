import { json_format } from './json-format'
import { list_patch, type ListEntryMatcher } from './list-patch'
import { parse_jsonc } from './parse-jsonc'

interface PatchJsonListOptions {
	field: string
	ensure?: ReadonlyArray<string>
	remove?: ReadonlyArray<ListEntryMatcher>
}

// A JSON list field may be authored as a bare string (tsconfig `extends` accepts `string` or
// `string[]`); normalize both forms — and an absent field — to an array for patching.
function normalize_list(value: unknown): ReadonlyArray<string> {
	if (typeof value === 'string') return [value]
	if (Array.isArray(value)) return value.map(String)

	return []
}

function serialize(parsed: Record<string, unknown>): string {
	return json_format.format_json(parsed)
}

// Ensure/remove the entries of one JSON list field, preserving every other key. A present field
// keeps its position; a new field is appended last. Returns the input unchanged when nothing is
// added or removed, so re-runs are idempotent. Comments are dropped — see the value-only decision.
function patch_json_list_field(content: string, options: PatchJsonListOptions): string {
	const parsed = parse_jsonc(content)
	const existing = normalize_list(parsed[options.field])
	const { next, is_changed } = list_patch.apply_list_patch(existing, options)
	if (!is_changed) return content

	return serialize({ ...parsed, [options.field]: [...next] })
}

const json_list = {
	patch_json_list_field,
}

export type { PatchJsonListOptions }
export { json_list }
