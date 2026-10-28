import { issue_cite } from '#scripts/issue/issue-cite'

// The review-finding line's grammar, its category vocabulary and the aggregation over it — the single
// place all three are defined. A `/code-review` round's findings evaporated
// the moment they were fixed, so no one could say which category recurred. They now land in the same
// append-only ledger the observation lines use (`.josh/observations/`), under a distinct `- rf:`
// prefix so `observation-ledger-line.ts`'s `- k:` grammar never treats them as its own — one ledger,
// one commit path, a second line *type* rather than a second ledger.

// **The interaction review writes the same grammar under its own prefix** (joshuafolkken/kit#4276), so
// its round is told apart from `/code-review`'s by the merge gate, and its findings stay out of the
// `/code-review` tally a reader compares rounds by.
const PREFIX = { code: '- rf:', interaction: '- ri:' } as const
const FIELD_SEPARATOR = ' | '
const FIELD_COUNT = 5
// **The disposition is a sixth field, written only when given** (joshuafolkken/kit#5286): a line
// written before it existed keeps its five and reads as a finding with no disposition.
const DISPOSED_FIELD_COUNT = FIELD_COUNT + 1
const ISSUE_FIELD_INDEX = FIELD_COUNT - 1
const SEVERITY_FIELD_INDEX = 1

// The nine review-rubric categories, as slugs (`prompts/review-rubric.md` → "Review categories"). A
// finding's category must be one of these so the aggregate stays countable rather than free text.
const CATEGORIES = [
	'bug-risks',
	'security',
	'performance',
	'project-conventions',
	'i18n',
	'tests',
	'comments',
	'assumptions',
	'confidence',
] as const

const SEVERITIES = ['high', 'medium', 'low'] as const

// What became of a finding: fixed in this tree, a verified false positive, or left to another issue.
// Only the first two close it for `josh review:round2`.
const CLOSING_DISPOSITIONS = ['fixed', 'false-positive'] as const
const DISPOSITION_PATTERN = /^(?:fixed|false-positive|(?:filed|deferred):#[1-9]\d*)$/u
const DISPOSITION_SEPARATOR = ' '

// The sentinel a zero-finding round writes, so "a round ran and found nothing" is a recorded line
// rather than an absent one — the count's denominator survives.
const NONE = 'none'
const NO_FILE = '-'

type Category = (typeof CATEGORIES)[number]
type Severity = (typeof SEVERITIES)[number]
type LineKind = keyof typeof PREFIX

interface Finding {
	category: Category
	severity: Severity
	file: string
	disposition?: string
}

interface DisposedSpec {
	disposition: string | undefined
	spec: string
}

interface CategoryCount {
	category: string
	count: number
}

function is_category(value: string): value is Category {
	return (CATEGORIES as ReadonlyArray<string>).includes(value)
}

function is_severity(value: string): value is Severity {
	return (SEVERITIES as ReadonlyArray<string>).includes(value)
}

// A file field is valid only when it is non-empty and carries no field separator — a ` | ` inside it
// would split into an extra field the reader counts as malformed and drops from the tally, so the
// writer refuses it here where the separator is defined rather than letting it ride into the ledger.
function is_valid_file(file: string): boolean {
	return file.length > 0 && !file.includes(FIELD_SEPARATOR)
}

function is_disposition(value: string): boolean {
	return DISPOSITION_PATTERN.test(value)
}

function is_closing(disposition: string | undefined): boolean {
	return (CLOSING_DISPOSITIONS as ReadonlyArray<string | undefined>).includes(disposition)
}

// A positional's leading disposition — `fixed <spec>`, `filed:#12 <spec>` — split from the spec it
// marks. The token the reviewer already writes before a finding it fixed, so one grammar serves both.
function split_disposition(positional: string): DisposedSpec {
	const end = positional.indexOf(DISPOSITION_SEPARATOR)
	const head = end === -1 ? '' : positional.slice(0, end)

	if (!is_disposition(head)) return { disposition: undefined, spec: positional }

	return { disposition: head, spec: positional.slice(end + DISPOSITION_SEPARATOR.length) }
}

function issue_field(issue: number): string {
	return issue_cite.plain(issue)
}

function line_of(fields: ReadonlyArray<string>, kind: LineKind): string {
	return `${PREFIX[kind]}${fields.join(FIELD_SEPARATOR)}`
}

function finding_line(
	finding: Finding,
	date: string,
	issue: number,
	kind: LineKind = 'code',
): string {
	const fields = [finding.category, finding.severity, finding.file, date, issue_field(issue)]

	return line_of(
		finding.disposition === undefined ? fields : [...fields, finding.disposition],
		kind,
	)
}

// **A zero-finding round records `none`, not nothing.** Reading its absence as "no findings" would
// merge the round that found nothing with the round nobody recorded, which is the exact confusion the
// ledger exists to end.
function zero_round_line(date: string, issue: number, kind: LineKind = 'code'): string {
	return line_of([NONE, NONE, NO_FILE, date, issue_field(issue)], kind)
}

function is_finding_line(line: string, kind: LineKind = 'code'): boolean {
	return line.trimStart().startsWith(PREFIX[kind])
}

function fields_of(line: string, kind: LineKind = 'code'): ReadonlyArray<string> {
	return line.trimStart().slice(PREFIX[kind].length).split(FIELD_SEPARATOR)
}

// The line's fields, or `undefined` for a malformed one — five, or six with a disposition.
function well_formed_fields(
	line: string,
	kind: LineKind = 'code',
): ReadonlyArray<string> | undefined {
	const fields = fields_of(line, kind)

	return fields.length === FIELD_COUNT || fields.length === DISPOSED_FIELD_COUNT
		? fields
		: undefined
}

function category_of(line: string): string | undefined {
	return well_formed_fields(line)?.[0]
}

function increment(counts: Map<string, number>, category: string): void {
	counts.set(category, (counts.get(category) ?? 0) + 1)
}

// The category a line contributes to the tally, or `undefined` for a non-finding line and for the
// `none` zero-round sentinel — which is a marker, not a category, and counted by `zero_round_count`.
function finding_category(line: string): string | undefined {
	if (!is_finding_line(line)) return undefined

	const category = category_of(line)

	return category === NONE ? undefined : category
}

function tally(content: string): Map<string, number> {
	const counts = new Map<string, number>()

	for (const line of content.split('\n')) {
		const category = finding_category(line)

		if (category !== undefined) increment(counts, category)
	}

	return counts
}

// Every real finding's category paired with its count, most frequent first, ties broken by name.
function category_counts(content: string): ReadonlyArray<CategoryCount> {
	return [...tally(content)]
		.map(([category, count]) => ({ category, count }))
		.toSorted(
			(left, right) => right.count - left.count || left.category.localeCompare(right.category),
		)
}

// The number of rounds that recorded zero findings — the denominator half that a bare category count
// cannot show.
function zero_round_count(content: string): number {
	return content.split('\n').filter((line) => is_finding_line(line) && category_of(line) === NONE)
		.length
}

// The issue a finding line is keyed to — its fifth field, the `#<N>` token — or `undefined` for a
// non-finding or malformed line. The record check reads this to ask whether a given issue's round was
// recorded at all.
function issue_of(line: string, kind: LineKind): string | undefined {
	return well_formed_fields(line, kind)?.[ISSUE_FIELD_INDEX]
}

interface DisposedLine {
	severity: string
	disposition: string | undefined
}

// One issue's `- rf:` lines, each with its severity and disposition — `undefined` disposition for a
// line written without one. `josh review:round2` reads round 1's closure from this.
function issue_dispositions(content: string, issue: number): ReadonlyArray<DisposedLine> {
	const target = issue_field(issue)

	return content
		.split('\n')
		.filter((line) => is_finding_line(line) && issue_of(line, 'code') === target)
		.map((line) => well_formed_fields(line) ?? [])
		.map((fields) => ({
			severity: fields[SEVERITY_FIELD_INDEX] ?? NONE,
			disposition: fields[FIELD_COUNT],
		}))
}

// **A `none` zero-round line counts as recorded, exactly like a real finding line does.** The gate
// asks whether the round was recorded, not whether it found anything — reading the issue field, which
// a zero-finding line carries too, is what keeps a clean round's single line from reading as "nobody
// recorded this".
function has_issue_record(content: string, issue: number, kind: LineKind = 'code'): boolean {
	const target = issue_field(issue)

	return content
		.split('\n')
		.some((line) => is_finding_line(line, kind) && issue_of(line, kind) === target)
}

const review_finding_ledger = {
	CATEGORIES,
	category_counts,
	finding_line,
	has_issue_record,
	is_category,
	is_closing,
	is_finding_line,
	is_severity,
	is_valid_file,
	issue_dispositions,
	SEVERITIES,
	split_disposition,
	zero_round_count,
	zero_round_line,
}

export type { CategoryCount, DisposedLine, Finding, LineKind }
export { review_finding_ledger }
