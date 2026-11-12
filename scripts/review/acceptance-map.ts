import { createHash } from 'node:crypto'
import { epic_audit_logic } from '#scripts/epic/epic-audit'
import { markdown_section } from '#scripts/issue/markdown-section'
import { session_cite } from '#scripts/issue/session-cite'
import { report_format_reference } from '#scripts/report/report-format-reference'

// A green gate and a clean review say the diff is sound, never that it delivers what the Issue asked
// for. **This is the seam where each acceptance criterion is checked one by one**: the pull request
// body carries one row per criterion — met, with its evidence, or deferred to a split-off issue — and
// `josh followup` re-reads the Issue just before the merge and refuses a criterion with no row.
//
// **A criterion is matched by an identifier built from its own text**, so a criterion added or
// reworded after the body was written has an identifier no row carries, and is refused as unmapped
// rather than passing on a stale row. The checkbox is stripped first: ticking it changes nothing.
//
// The criteria are read through `epic_audit_logic.acceptance_section`, the one place the acceptance
// headings are defined.

const MAP_HEADING = '## 受け入れ条件の対応'
const MET = '満たした'
const DEFERRED = '見送り'
const PENDING = '未記入'
const PENDING_SUFFIX = `— ${PENDING}`
const ID_PREFIX = 'ac-'
const ID_HEX_LENGTH = 8
const BACKTICK = '`'
// A top-level list item only: a nested item is detail under a criterion, not one of its own.
const CRITERION_PATTERN = /^(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?(?<text>\S.*)$/u
// A list item, heading, table row or HTML comment opens a block of its own, never a wrapped line.
const BLOCK_START_PATTERN = /^\s*(?:(?:[-*+]|\d+\.)\s|#|\||<!--)/u
// The criterion's text may sit between the identifier and the status for the reader, so the status is
// the last status word on the line — a criterion quoting the row format stays text.
const ROW_PATTERN = new RegExp(
	String.raw`^[-*]\s+${BACKTICK}(?<id>${ID_PREFIX}[0-9a-f]{${String(ID_HEX_LENGTH)}})${BACKTICK}(?:\s.*)?\s(?<kind>${MET}|${DEFERRED}):\s*(?<rest>\S.*)$`,
	'u',
)
const PENDING_ROW_PATTERN = new RegExp(
	String.raw`^[-*]\s+${BACKTICK}(?<id>${ID_PREFIX}[0-9a-f]{${String(ID_HEX_LENGTH)}})${BACKTICK}.*\s${PENDING_SUFFIX}$`,
	'u',
)
// A deferral names the split-off issue first, then why it was deferred.
const DEFERRAL_PATTERN = /^(?<issue>(?:[\w.-]+\/[\w.-]+)?#\d+)\s+\S/u
const ROW_FORMAT = `under ${MAP_HEADING}, one line per acceptance criterion: \`- \`<id>\` <criterion> — ${MET}: <test name, file:line or command output>\` or \`- \`<id>\` <criterion> — ${DEFERRED}: #<split-off issue> <reason>\``

interface Criterion {
	id: string
	text: string
}

interface CriterionLine {
	text: string
	index: number
}

interface Deferral {
	id: string
	issue: string
}

interface Row {
	id: string
	kind: string
	rest: string
}

interface MapRows {
	met: ReadonlySet<string>
	deferrals: ReadonlyArray<Deferral>
	ids: ReadonlySet<string>
}

interface MapComparison {
	missing: ReadonlyArray<Criterion>
	deferrals: ReadonlyArray<Deferral>
	stale: ReadonlyArray<string>
}

function criterion_id(text: string): string {
	const normalized = text.replaceAll(/\s+/gu, ' ').trim()
	const digest = createHash('sha256').update(normalized).digest('hex')

	return `${ID_PREFIX}${digest.slice(0, ID_HEX_LENGTH)}`
}

function joins(last: string, line: string): boolean {
	const is_continuation = line.trim() !== '' && !BLOCK_START_PATTERN.test(line)

	return is_continuation && CRITERION_PATTERN.test(last)
}

function append_line(items: Array<CriterionLine>, line: string, index: number): void {
	const last = items.at(-1)

	if (last !== undefined && joins(last.text, line)) last.text += ` ${line.trim()}`
	else items.push({ text: line, index })
}

// A criterion wrapped onto continuation lines is one criterion, hashed whole — rewording any of its
// lines changes its identifier. A blank line or a nested item ends it.
function unwrapped(lines: ReadonlyArray<string>): ReadonlyArray<CriterionLine> {
	const items: Array<CriterionLine> = []

	for (const [index, line] of lines.entries()) {
		append_line(items, line, index)
	}

	return items
}

function criteria_of(issue_body: string | undefined): ReadonlyArray<Criterion> {
	// A list item inside a code fence is an example the Issue quotes, not a criterion. An indented line
	// outside one is a wrapped criterion's continuation, so it is kept.
	const lines = markdown_section.fence_free_lines(epic_audit_logic.acceptance_section(issue_body))
	const texts = unwrapped(lines).map((line) => CRITERION_PATTERN.exec(line.text)?.groups?.['text'])

	return texts
		.filter((text): text is string => text !== undefined)
		.map((text) => ({ id: criterion_id(text), text: text.trim() }))
}

function selected_line(line: CriterionLine, ids: ReadonlySet<string>): boolean {
	const text = CRITERION_PATTERN.exec(line.text)?.groups?.['text']

	return text !== undefined && ids.has(criterion_id(text))
}

function tick_line(line: string): string {
	const checkbox = /^(?<prefix>(?:[-*+]|\d+\.)\s+)\[[ xX]\]/u

	if (!checkbox.test(line)) throw new Error('Selected acceptance criterion has no checkbox')

	return line.replace(/^(?<prefix>(?:[-*+]|\d+\.)\s+)\[ \]/u, '$<prefix>[x]')
}

function tick_section(section: string, ids: ReadonlySet<string>): string {
	const visible = markdown_section.fence_free_lines(section)
	const selected = new Set(
		unwrapped(visible)
			.filter((line) => selected_line(line, ids))
			.map((line) => line.index),
	)

	return section
		.split('\n')
		.map((line, index) => (selected.has(index) ? tick_line(line) : line))
		.join('\n')
}

// IDs come from the plan's acceptance map. Resolve every ID before editing, so a stale plan cannot
// partially tick an Issue. Only checkbox markers in the canonical acceptance section are changed.
function tick(body: string, ids: ReadonlyArray<string>): string {
	const criteria = criteria_of(body)
	const unknown = ids.filter((id) => criteria.every((criterion) => criterion.id !== id))

	if (unknown.length > 0) throw new Error(`Unknown acceptance criteria: ${unknown.join(', ')}`)

	return markdown_section.map_section(body, epic_audit_logic.is_acceptance_heading, (section) =>
		tick_section(section, new Set(ids)),
	)
}

// A deferral row with no issue or no reason is no row at all, so its criterion reads as unmapped.
function deferral_of(id: string, rest: string): Deferral | undefined {
	const issue = DEFERRAL_PATTERN.exec(rest)?.groups?.['issue']

	return issue === undefined ? undefined : { id, issue }
}

// Every group in `ROW_PATTERN` is mandatory, so a match always carries the name.
function group(groups: Readonly<Record<string, string>>, name: string): string {
	return groups[name] ?? ''
}

// A pending row is no row even when the criterion it quotes carries a status word — otherwise the
// skeleton's own unfilled row would read as met.
function row_of(line: string): Row | undefined {
	const trimmed = line.trim()

	if (trimmed.endsWith(PENDING_SUFFIX)) return undefined
	const groups = ROW_PATTERN.exec(trimmed)?.groups

	if (groups === undefined) return undefined

	return { id: group(groups, 'id'), kind: group(groups, 'kind'), rest: group(groups, 'rest') }
}

// A row inside a code fence is an example the body quotes, not a claim (joshuafolkken/kit#6574).
function rows_of(pr_body = ''): MapRows {
	const rows = markdown_section
		.fence_free_lines(markdown_section.section_lines(pr_body, MAP_HEADING).join('\n'))
		.map((line) => row_of(line))
		.filter((row): row is Row => row !== undefined)
	const met = rows.filter((row) => row.kind === MET).map((row) => row.id)
	const deferrals = rows
		.filter((row) => row.kind === DEFERRED)
		.map((row) => deferral_of(row.id, row.rest))
		.filter((deferral): deferral is Deferral => deferral !== undefined)

	return { met: new Set(met), deferrals, ids: new Set([...met, ...deferrals.map((row) => row.id)]) }
}

function compare(criteria: ReadonlyArray<Criterion>, rows: MapRows): MapComparison {
	const current = new Set(criteria.map((criterion) => criterion.id))

	return {
		missing: criteria.filter((criterion) => !rows.ids.has(criterion.id)),
		deferrals: rows.deferrals.filter((deferral) => current.has(deferral.id)),
		stale: [...rows.ids].filter((id) => !current.has(id)),
	}
}

// What `josh pr` writes when the caller's body carries no table: every criterion as a pending row,
// which the merge refuses until it is filled in.
function skeleton(issue_body: string | undefined): string | undefined {
	const criteria = criteria_of(issue_body)

	if (criteria.length === 0) return undefined
	const rows = criteria.map(
		(criterion) => `- \`${criterion.id}\` ${criterion.text} ${PENDING_SUFFIX}`,
	)

	return [MAP_HEADING, '', ...rows].join('\n')
}

function met_line(line: string, titles: ReadonlyArray<string>): string {
	const id = PENDING_ROW_PATTERN.exec(line.trim())?.groups?.['id']
	const title = id === undefined ? undefined : titles.find((candidate) => candidate.includes(id))

	if (title === undefined) return line

	return `${line.trimEnd().slice(0, -PENDING.length)}${MET}: ${BACKTICK}${title}${BACKTICK}`
}

// **A pending row whose criterion a test title names by its identifier is met by that test**, so the
// run copies no criterion into the body by hand (joshuafolkken/kit#5541). A row with no such title
// stays pending, and a row already filled in is never rewritten.
function with_test_rows(body: string, titles: ReadonlyArray<string>): string {
	return body
		.split('\n')
		.map((line) => met_line(line, titles))
		.join('\n')
}

function has_map(pr_body = ''): boolean {
	return markdown_section.has_unfenced_line(pr_body, MAP_HEADING)
}

function listed(title: string, lines: ReadonlyArray<string>): ReadonlyArray<string> {
	return lines.length === 0 ? [] : [title, ...lines.map((line) => `  ${line}`)]
}

function refusal_message(
	issue: string,
	comparison: MapComparison,
	absent: ReadonlyArray<string>,
): string {
	return [
		`The pull request body does not map every acceptance criterion of ${session_cite.issue(issue)} as it reads now, so the merge is refused.`,
		...listed(
			'Criteria with no row (added or reworded since the body was written, or never mapped):',
			comparison.missing.map((criterion) => `- \`${criterion.id}\` ${criterion.text}`),
		),
		...listed('Deferral rows naming an issue that could not be found:', absent),
		...listed('Rows naming no current criterion:', comparison.stale),
		`Write ${ROW_FORMAT} — format: ${report_format_reference.pointer(report_format_reference.ACCEPTANCE_MAP_HEADING)}`,
		'Write it into the `--body-file` before `josh ship`, or update an open PR with `gh api -X PATCH repos/{owner}/{repo}/pulls/<N> -F body=@<path>`, then re-run.',
	].join('\n')
}

const acceptance_map = {
	MAP_HEADING,
	compare,
	criteria_of,
	criterion_id,
	has_map,
	refusal_message,
	ROW_FORMAT,
	rows_of,
	skeleton,
	with_test_rows,
	tick,
}

export type { Criterion, Deferral, MapComparison }
export { acceptance_map }
