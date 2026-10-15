import { json_value } from '#scripts/lib/json-value'

type ChangeKind = 'create' | 'merge' | 'overwrite' | 'delete'

interface FileChange {
	path: string
	before: string | undefined
	after: string | undefined
}

type JsonRecord = Record<string, unknown>

const PACKAGE_JSON = 'package.json'
const JSON_EXTENSION = '.json'
const KIND_WIDTH = 'overwrite'.length
const NO_CHANGES = '  (no file changes)'

// Every path whose content differs between the two snapshots, sorted, so a run reads the same twice.
function changed_files(
	before: ReadonlyMap<string, string>,
	after: ReadonlyMap<string, string>,
): Array<FileChange> {
	const paths = [...new Set([...before.keys(), ...after.keys()])].toSorted((left, right) =>
		left.localeCompare(right),
	)

	return paths
		.filter((file) => before.get(file) !== after.get(file))
		.map((file) => ({ path: file, before: before.get(file), after: after.get(file) }))
}

// A changed file is a merge when every line it had survives — the project's own content is kept —
// and an overwrite when any of its lines is replaced or removed.
function keeps_every_line(before: string, after: string): boolean {
	const remaining = new Set(after.split('\n'))

	return before.split('\n').every((line) => remaining.has(line))
}

function is_kept_array(before: ReadonlyArray<unknown>, after: unknown): boolean {
	if (!Array.isArray(after)) return false
	const remaining = new Set(after.map((value) => JSON.stringify(value)))

	return before.every((value) => remaining.has(JSON.stringify(value)))
}

// A JSON file is rewritten whole when kit adds to it — `package.json` written out again, a list grown — so
// it is compared by value: a merge when every value it had is still there, wherever the lines moved.
function is_kept(before: unknown, after: unknown): boolean {
	if (Array.isArray(before)) return is_kept_array(before, after)
	if (!json_value.is_record(before) || !json_value.is_record(after)) return before === after

	return Object.keys(before).every((key) => is_kept(before[key], after[key]))
}

// Undefined when either side is not plain JSON (a `tsconfig.json` with comments), which falls back
// to the line test.
function keeps_every_value(before: string, after: string): boolean | undefined {
	const old_value = json_value.parse_or_undefined(before)
	const new_value = json_value.parse_or_undefined(after)
	if (old_value === undefined || new_value === undefined) return undefined

	return is_kept(old_value, new_value)
}

function keeps_content(file: string, before: string, after: string): boolean {
	const is_kept_by_value = file.endsWith(JSON_EXTENSION)
		? keeps_every_value(before, after)
		: undefined

	return is_kept_by_value ?? keeps_every_line(before, after)
}

function change_kind(change: FileChange): ChangeKind {
	if (change.before === undefined) return 'create'
	if (change.after === undefined) return 'delete'

	return keeps_content(change.path, change.before, change.after) ? 'merge' : 'overwrite'
}

function parse_record(content: string | undefined): JsonRecord {
	const parsed = content === undefined ? undefined : json_value.parse_or_undefined(content)

	return json_value.is_record(parsed) ? parsed : {}
}

function changed_keys(before: JsonRecord, after: JsonRecord): Array<string> {
	const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]

	return keys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
}

function entry_line(name: string, before: unknown, after: unknown): string {
	if (before === undefined) return `+ ${name} ${JSON.stringify(after)}`
	if (after === undefined) return `- ${name}`

	return `~ ${name} ${JSON.stringify(before)} → ${JSON.stringify(after)}`
}

// A missing field reads as an empty object, so a block added or removed whole is listed too.
function as_entries(value: unknown): JsonRecord | undefined {
	if (value === undefined) return {}

	return json_value.is_record(value) ? value : undefined
}

// A field that is an object (`scripts`, `devDependencies`) is listed entry by entry, so the plan
// names each script and dependency rather than the whole block.
function field_lines(key: string, before: unknown, after: unknown): Array<string> {
	const old_entries = as_entries(before)
	const new_entries = as_entries(after)

	if (old_entries === undefined || new_entries === undefined) {
		return [entry_line(key, before, after)]
	}

	return changed_keys(old_entries, new_entries).map((name) =>
		entry_line(`${key}.${name}`, old_entries[name], new_entries[name]),
	)
}

function package_json_lines(change: FileChange): Array<string> {
	const before = parse_record(change.before)
	const after = parse_record(change.after)

	return changed_keys(before, after).flatMap((key) => field_lines(key, before[key], after[key]))
}

function change_lines(change: FileChange): Array<string> {
	const head = `  ${change_kind(change).padEnd(KIND_WIDTH)} ${change.path}`
	if (change.path !== PACKAGE_JSON || change.after === undefined) return [head]

	return [head, ...package_json_lines(change).map((line) => `      ${line}`)]
}

function format_report(
	title: string,
	changes: ReadonlyArray<FileChange>,
	dependency_lines: ReadonlyArray<string>,
): string {
	const files =
		changes.length === 0 ? [NO_CHANGES] : changes.flatMap((change) => change_lines(change))
	const dependencies = dependency_lines.map((line) => `  ${line}`)

	return [title, '', 'Files:', ...files, '', 'Dependencies:', ...dependencies].join('\n')
}

const init_dry_run_report = { changed_files, change_kind, package_json_lines, format_report }
export { init_dry_run_report }
export type { ChangeKind, FileChange }
