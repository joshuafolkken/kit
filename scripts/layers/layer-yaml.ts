import { readFileSync } from 'node:fs'
import { yaml_document } from '#scripts/yaml-document'

// The narrowing both configuration readers do, written once (joshuafolkken/kit#1313).
//
// `lefthook.yml` and a GitHub Actions workflow are read for the same three shapes — a mapping, a
// sequence, a scalar string — and neither reader may assume the file is well formed: a hook section
// carrying a list where a mapping belongs is someone else's error to report, not a crash here. So
// every accessor answers `undefined` rather than throwing, and a caller that finds nothing simply
// contributes no steps.
//
// It reads a document through `yaml-document.ts` rather than calling js-yaml itself, so the
// empty-document handling that module restored stays in one place.

function as_record(value: unknown): Record<string, unknown> | undefined {
	if (!yaml_document.is_mapping_document(value)) return undefined

	return value
}

function as_string(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined

	return value
}

// A predicate rather than `Array.isArray` inline: the built-in narrows to `any[]`, which then
// escapes into every caller as an unchecked value. Narrowing to `ReadonlyArray<unknown>` here means
// each element still has to go through `as_record` / `as_string` before it is used.
function is_unknown_array(value: unknown): value is ReadonlyArray<unknown> {
	return Array.isArray(value)
}

function as_array(value: unknown): ReadonlyArray<unknown> | undefined {
	if (!is_unknown_array(value)) return undefined

	return value
}

// Entries of a mapping, or nothing at all where the key is absent or holds something else.
function record_entries(
	parent: Record<string, unknown>,
	key: string,
): ReadonlyArray<[string, unknown]> {
	return Object.entries(as_record(parent[key]) ?? {})
}

// A configuration file's text, or nothing where it could not be read. Both readers go through this
// one: a directory or a dangling symlink named `something.yml`, or a file removed between a
// listing and the read, is a report with one fewer source rather than a stack trace out of
// `josh layers`.
function read_text(file_path: string): string | undefined {
	try {
		return readFileSync(file_path, 'utf8')
	} catch {
		return undefined
	}
}

// A YAML document as a mapping. An unparseable file answers `undefined` so the command can report
// which file it could not read instead of failing outright.
function parse_document(content: string): Record<string, unknown> | undefined {
	try {
		return yaml_document.parse_yaml(content)
	} catch {
		return undefined
	}
}

// A sequence of strings, tolerating the single-scalar spelling YAML allows wherever a list is
// accepted — `extends: ./base.yml` and `on: pull_request` are both legal.
function string_list(value: unknown): ReadonlyArray<string> {
	const single = as_string(value)
	if (single !== undefined) return [single]

	return (as_array(value) ?? [])
		.map((item) => as_string(item))
		.filter((item): item is string => item !== undefined)
}

const layer_yaml = {
	as_array,
	as_record,
	as_string,
	parse_document,
	read_text,
	record_entries,
	string_list,
}

export { layer_yaml }
