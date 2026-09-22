// The observation ledger's line grammar (`.claude/skills/workflow-commands/observation-filing.md`)
// is fixed — `- k:<slug> | d<n> | <YYYY-MM-DD> | <where> | <what>` — but the path was collected in
// `observation-ledger.ts` without a line ever being parsed, so a malformed append rode a flush
// through unremarked. This validates a ledger entry line and reports why a broken one is broken
// (joshuafolkken/kit#2123). The grammar is the single source's, pinned by the document test.

const KEY_PREFIX = '- k:'
const FIELD_SEPARATOR = ' | '
const FIELD_COUNT = 5
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
// `d1` and up — never `d0`, since a depth-0 observation goes straight to an issue rather than the
// ledger.
const DEPTH_PATTERN = /^d[1-9]\d*$/u
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const SLUG_REASON = 'the slug must be lowercase words joined by `-`'
const DEPTH_REASON = 'the depth must be `d1` or higher (never `d0`)'
const DATE_REASON = 'the date must be `YYYY-MM-DD`'
const WHERE_REASON = 'the `where` field is empty'
const WHAT_REASON = 'the `what` field is empty'

interface BrokenLine {
	line: string
	reason: string
}

// A ledger entry line, as opposed to prose or a heading — only these are held to the grammar.
function is_ledger_entry_line(line: string): boolean {
	return line.trimStart().startsWith(KEY_PREFIX)
}

function slug_of(first_field: string): string {
	return first_field.trimStart().slice(KEY_PREFIX.length)
}

// The `?? ''` lives in these small helpers rather than in `field_reason`, so that function stays a
// single lookup with no branching of its own.
function is_present(field: string | undefined): boolean {
	return (field ?? '').trim().length > 0
}

function matches(pattern: RegExp, field: string | undefined): boolean {
	return pattern.test(field ?? '')
}

function slug_ok(key_field: string | undefined): boolean {
	return SLUG_PATTERN.test(slug_of(key_field ?? ''))
}

// Each field's check paired with the reason it fails, so `field_reason` is a single lookup for the
// first failing field rather than a chain of branches.
function field_reason(fields: ReadonlyArray<string>): string | undefined {
	const [key_field, depth, date, where, what] = fields
	const checks: ReadonlyArray<readonly [boolean, string]> = [
		[slug_ok(key_field), SLUG_REASON],
		[matches(DEPTH_PATTERN, depth), DEPTH_REASON],
		[matches(DATE_PATTERN, date), DATE_REASON],
		[is_present(where), WHERE_REASON],
		[is_present(what), WHAT_REASON],
	]

	return checks.find(([is_valid]) => !is_valid)?.[1]
}

// The reason a ledger entry line breaks the grammar, or `undefined` when it conforms. Too few fields
// or a `|` inside `<what>` both land as the wrong field count, since a conforming `<what>` carries no
// vertical bar.
function line_reason(line: string): string | undefined {
	const fields = line.split(FIELD_SEPARATOR)

	if (fields.length !== FIELD_COUNT) {
		return `expected ${String(FIELD_COUNT)} fields separated by " | " (a \`|\` in the last field is not allowed)`
	}

	return field_reason(fields)
}

// Every ledger entry line that breaks the grammar, paired with why; an empty array is a clean ledger.
function broken_ledger_lines(content: string): ReadonlyArray<BrokenLine> {
	return content
		.split('\n')
		.filter((line) => is_ledger_entry_line(line))
		.map((line) => ({ line, reason: line_reason(line) }))
		.filter((entry): entry is BrokenLine => entry.reason !== undefined)
}

const observation_ledger_line = {
	broken_ledger_lines,
	is_ledger_entry_line,
	line_reason,
}

export type { BrokenLine }
export { observation_ledger_line }
