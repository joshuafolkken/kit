// The review-finding line's grammar, its category vocabulary and the aggregation over it — the single
// place all three are defined (joshuafolkken/kit#2325). A `/code-review` round's findings evaporated
// the moment they were fixed, so no one could say which category recurred. They now land in the same
// append-only ledger the observation lines use (`docs/observations.md`), under a distinct `- rf:`
// prefix so `observation-ledger-line.ts`'s `- k:` grammar never treats them as its own — one ledger
// file, one flush path, a second line *type* rather than a second ledger.

const FINDING_PREFIX = '- rf:'
const FIELD_SEPARATOR = ' | '
const FIELD_COUNT = 5

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

// The sentinel a zero-finding round writes, so "a round ran and found nothing" is a recorded line
// rather than an absent one — the count's denominator survives.
const NONE = 'none'
const NO_FILE = '-'

type Category = (typeof CATEGORIES)[number]
type Severity = (typeof SEVERITIES)[number]

interface Finding {
	category: Category
	severity: Severity
	file: string
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

function issue_field(issue: number): string {
	return `#${String(issue)}`
}

function line_of(fields: ReadonlyArray<string>): string {
	return `${FINDING_PREFIX}${fields.join(FIELD_SEPARATOR)}`
}

function finding_line(finding: Finding, date: string, issue: number): string {
	return line_of([finding.category, finding.severity, finding.file, date, issue_field(issue)])
}

// **A zero-finding round records `none`, not nothing.** Reading its absence as "no findings" would
// merge the round that found nothing with the round nobody recorded, which is the exact confusion the
// ledger exists to end.
function zero_round_line(date: string, issue: number): string {
	return line_of([NONE, NONE, NO_FILE, date, issue_field(issue)])
}

function is_finding_line(line: string): boolean {
	return line.trimStart().startsWith(FINDING_PREFIX)
}

function category_of(line: string): string | undefined {
	const fields = line.trimStart().slice(FINDING_PREFIX.length).split(FIELD_SEPARATOR)

	return fields.length === FIELD_COUNT ? fields[0] : undefined
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
// recorded at all (joshuafolkken/kit#2343).
function issue_of(line: string): string | undefined {
	const fields = line.trimStart().slice(FINDING_PREFIX.length).split(FIELD_SEPARATOR)

	return fields.length === FIELD_COUNT ? fields[FIELD_COUNT - 1] : undefined
}

// **A `none` zero-round line counts as recorded, exactly like a real finding line does.** The gate
// asks whether the round was recorded, not whether it found anything — reading the issue field, which
// a zero-finding line carries too, is what keeps a clean round's single line from reading as "nobody
// recorded this" (joshuafolkken/kit#2343).
function has_issue_record(content: string, issue: number): boolean {
	const target = issue_field(issue)

	return content.split('\n').some((line) => is_finding_line(line) && issue_of(line) === target)
}

const review_finding_ledger = {
	CATEGORIES,
	SEVERITIES,
	category_counts,
	finding_line,
	has_issue_record,
	is_category,
	is_finding_line,
	is_severity,
	is_valid_file,
	zero_round_count,
	zero_round_line,
}

export type { CategoryCount, Finding }
export { review_finding_ledger }
