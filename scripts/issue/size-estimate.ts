import type { OpenIssueData } from '#scripts/git/git-schemas'
import { split_assess, type SizeMeasurement } from '#scripts/split/split-assess'
import { z } from 'zod'
import { SPLIT_ROUTE_LABEL } from './issue-labels'
import { markdown_section } from './markdown-section'

// joshuafolkken/kit#4675: a request clearly over the split guide reached a lane as one Issue because
// nothing asked for its size when it was filed, and a split is cheapest at filing time. Every filing
// declares its estimate under the background heading, so it stays on the Issue; one over the guide is
// refused unless it is filed as a split or says why it stays one Issue.
//
// **The guide is `split_assess`'s, never a copy** — the measured diff and the declared estimate are
// judged by one `verdict_for`. An epic (a body carrying `## Split rationale`) declares no estimate:
// its children do.

const BACKGROUND_HEADING = '## 背景'
const EPIC_HEADING = '## Split rationale'
const PREFIX = '- 規模見積もり:'
const HEADING_PREFIX = '## '
const { REASON_PREFIX } = split_assess
const DECLARATION = `${PREFIX} 約 <N> ファイル / <M> 行（テスト除く）`
// Full- or half-width parentheses alike: the two read the same to the person typing the line.
const VALUE_PATTERN =
	/^約\s*(?<files>\d+)\s*ファイル\s*\/\s*(?<lines>\d+)\s*行\s*[（(]テスト除く[）)]$/u
const MISSING = `missing size estimate: declare \`${DECLARATION}\` under ${BACKGROUND_HEADING}`
// The refusal ends in a line ready to paste (joshuafolkken/kit#5225).
const EXAMPLE = `${PREFIX} 約 3 ファイル / 60 行（テスト除く）`
const MALFORMED = `\`${PREFIX}\` must be written ${DECLARATION}\n${EXAMPLE}`
const estimate_schema = z.object({ files: z.coerce.number(), lines: z.coerce.number() })

function declared(body: string, prefix: string): string | undefined {
	const background = markdown_section.section_lines(body, BACKGROUND_HEADING).join('\n')
	const line = markdown_section
		.unfenced_lines(background)
		.map((text) => text.trim())
		.find((text) => text.startsWith(prefix))

	return line?.slice(prefix.length).trim()
}

function is_estimate_line(text: string): boolean {
	const trimmed = text.trim()

	return trimmed.startsWith(PREFIX) && VALUE_PATTERN.test(trimmed.slice(PREFIX.length).trim())
}

// joshuafolkken/kit#5758: a decision that widens an Issue's scope states the new estimate in its
// record; this is that line, trimmed, or `undefined` when the record states none that parses.
function stated_line(record: string): string | undefined {
	return markdown_section
		.unfenced_lines(record)
		.find((text) => is_estimate_line(text))
		?.trim()
}

// The index of the estimate line `parse` reads — the first under the background heading, before the
// next heading — or -1.
function declared_index(visible: ReadonlyArray<string>): number {
	const start = visible.findIndex((text) => text.trim() === BACKGROUND_HEADING) + 1
	if (start === 0) return -1
	const section = visible.slice(start)
	const end = section.findIndex((text) => text.trimStart().startsWith(HEADING_PREFIX))
	const bounded = end === -1 ? section : section.slice(0, end)
	const at = bounded.findIndex((text) => text.trimStart().startsWith(PREFIX))

	return at === -1 ? -1 : start + at
}

// `body` with its declared estimate line replaced by `line`, keeping the line's indentation; unchanged
// when it declares none.
function restated(body: string, line: string): string {
	const lines = [...markdown_section.lines_of(body)]
	const at = declared_index(markdown_section.unfenced_lines(body))
	const current = lines[at]
	if (current === undefined) return body
	lines[at] = `${current.slice(0, current.indexOf(PREFIX))}${line}`

	return lines.join('\n')
}

function is_epic(body: string): boolean {
	return markdown_section.has_line(body, EPIC_HEADING)
}

// The declared estimate judged against the guide, or `undefined` when there is none or it does not parse.
function parse(body: string): SizeMeasurement | undefined {
	const read = estimate_schema.safeParse(VALUE_PATTERN.exec(declared(body, PREFIX) ?? '')?.groups)

	if (!read.success) return undefined
	const { files, lines } = read.data

	return { files, lines, verdict: split_assess.verdict_for(files, lines) }
}

// The shape check `issue:lint` makes: the declaration is there and parses. The guide needs the route,
// which only `issue:file` knows, so it is `guide_problem`'s.
function problems(body: string): ReadonlyArray<string> {
	if (is_epic(body)) return []
	if (declared(body, PREFIX) === undefined) return [MISSING]

	return parse(body) === undefined ? [MALFORMED] : []
}

// A split filing, or one that declares why it stays one Issue, passes over the guide.
function is_excused(body: string, route: string | undefined): boolean {
	return route === SPLIT_ROUTE_LABEL || (declared(body, REASON_PREFIX) ?? '') !== ''
}

// The counts against the guide, shared by the filing refusal and `backlog:next`'s offer note.
function exceeded(estimate: SizeMeasurement): string {
	return `size estimate ${String(estimate.files)} file(s) / ${String(estimate.lines)} line(s) exceeds the guide (more than ${String(split_assess.FILE_GUIDE)} files or ${String(split_assess.LINE_GUIDE)} lines)`
}

function refusal(estimate: SizeMeasurement): string {
	return `${exceeded(estimate)} — file it split (\`--route split\`) or declare \`${REASON_PREFIX} <理由>\`; split-assessment.md → "${split_assess.QUESTION_SECTION}"`
}

// The declared estimate when it is over the guide and not excused; `undefined` under it, on a split
// filing, with the reason declared, or with no parsable estimate. `issue:file` and `backlog:next` both
// judge through it (joshuafolkken/kit#5384).
function over_guide(body: string, route: string | undefined): SizeMeasurement | undefined {
	const estimate = parse(body)

	if (estimate?.verdict !== split_assess.SPLIT_VERDICT) return undefined

	return is_excused(body, route) ? undefined : estimate
}

// The declared estimate when it is over the cap; a declared reason does not excuse it, only a split
// filing does (joshuafolkken/kit#5502). `issue:file` and `backlog:next` both judge through it.
function over_cap(body: string, route: string | undefined): SizeMeasurement | undefined {
	const estimate = parse(body)

	if (estimate === undefined || route === SPLIT_ROUTE_LABEL) return undefined

	return split_assess.is_over_cap(estimate.files, estimate.lines) ? estimate : undefined
}

// The filing route a row's labels carry — the split route, or none.
function route_of(labels: ReadonlyArray<string>): string | undefined {
	return labels.includes(SPLIT_ROUTE_LABEL) ? SPLIT_ROUTE_LABEL : undefined
}

// Whether an open Issue is declared over the cap — `backlog:next`, `auto-ok:next` and the idle
// notice all hold it for a person through this one check.
function is_issue_over_cap(issue: Pick<OpenIssueData, 'body' | 'labels'>): boolean {
	const labels = issue.labels?.map((label) => label.name) ?? []

	return over_cap(issue.body ?? '', route_of(labels)) !== undefined
}

// The counts against the cap, shared by the filing refusal and `backlog:next`'s withheld note.
function capped(estimate: SizeMeasurement): string {
	return `size estimate ${String(estimate.files)} file(s) / ${String(estimate.lines)} line(s) exceeds the cap (more than ${String(split_assess.FILE_CAP)} files or ${String(split_assess.LINE_CAP)} lines), which \`${REASON_PREFIX}\` does not excuse`
}

function cap_refusal(estimate: SizeMeasurement): string {
	return `${capped(estimate)} — file an ordered epic of \`--route split\` children instead (the mechanical changes first, the child that switches the setting on last); split-assessment.md → "${split_assess.QUESTION_SECTION}"`
}

// The filing refusal for an estimate over the cap, else over the guide. A missing or malformed
// estimate is `problems`' refusal, not this one.
function guide_problem(body: string, route: string | undefined): string | undefined {
	const over = over_cap(body, route)

	if (over !== undefined) return cap_refusal(over)
	const estimate = over_guide(body, route)

	return estimate === undefined ? undefined : refusal(estimate)
}

// The declared file count, or `undefined` when there is no estimate or it does not parse.
function declared_files(body: string): number | undefined {
	return parse(body)?.files
}

const size_estimate = {
	capped,
	declared_files,
	declared_size: parse,
	exceeded,
	guide_problem,
	is_issue_over_cap,
	over_cap,
	over_guide,
	problems,
	restated,
	route_of,
	stated_line,
}

export { size_estimate }
