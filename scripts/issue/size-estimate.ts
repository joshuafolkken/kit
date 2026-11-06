import type { OpenIssueData } from '#scripts/git/git-schemas'
import { lane_implement_rate, type ImplementRate } from '#scripts/lane/lane-implement-rate'
import { lane_stage_budget } from '#scripts/lane/lane-stage-budget'
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
//
// joshuafolkken/kit#5654: lanes land at twice their declaration at the median (`lane:stats`, files
// and lines alike), so the guide and the cap judge the declaration multiplied by
// `split_assess.DECLARED_GROWTH_FACTOR`. `parse` keeps the declared counts: `lane:plan` reads them as declared.

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
const { DECLARED_GROWTH_FACTOR } = split_assess
const IMPLEMENT_BUDGET = lane_stage_budget.BUDGET_MINUTES.implement

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

// A declared count as the guide and the cap judge it.
function grown(count: number): number {
	return count * DECLARED_GROWTH_FACTOR
}

function guide_for(rate?: ImplementRate): ReturnType<typeof split_assess.guide_for> {
	return split_assess.guide_for(IMPLEMENT_BUDGET, rate)
}

// The declared estimate, its verdict judged on the grown counts, or `undefined` when there is none or
// it does not parse.
function parse(body: string, rate?: ImplementRate): SizeMeasurement | undefined {
	const read = estimate_schema.safeParse(VALUE_PATTERN.exec(declared(body, PREFIX) ?? '')?.groups)

	if (!read.success) return undefined
	const { files, lines } = read.data

	return {
		files,
		lines,
		verdict: split_assess.verdict_for(grown(files), grown(lines), guide_for(rate)),
	}
}

// The declared counts, the factor and the grown counts, as every refusal prints them.
function projected(estimate: SizeMeasurement): string {
	const declared_counts = `${String(estimate.files)} file(s) / ${String(estimate.lines)} line(s)`
	const grown_counts = `${String(grown(estimate.files))} file(s) / ${String(grown(estimate.lines))} line(s)`

	return `size estimate ${declared_counts} × ${String(DECLARED_GROWTH_FACTOR)} = ${grown_counts}`
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

// The counts and any guide overrun, shared by filing refusals and `backlog:next`'s offer note.
function exceeded(estimate: SizeMeasurement, rate?: ImplementRate): string {
	if (estimate.verdict === split_assess.SINGLE_VERDICT) return projected(estimate)
	const guide = guide_for(rate)

	return `${projected(estimate)} exceeds the guide (more than ${String(guide.files)} files or ${String(guide.lines)} lines)`
}

function refusal(estimate: SizeMeasurement, rate?: ImplementRate): string {
	return `${exceeded(estimate, rate)} — file it split (\`--route split\`) or declare \`${REASON_PREFIX} <理由>\`; split-assessment.md → "${split_assess.QUESTION_SECTION}"`
}

// The declared estimate when it is over the guide, whatever excuses it; `undefined` under it or with
// no parsable estimate.
function guide_exceeded(body: string, rate?: ImplementRate): SizeMeasurement | undefined {
	const estimate = parse(body, rate)

	return estimate?.verdict === split_assess.SPLIT_VERDICT ? estimate : undefined
}

// The declared estimate when it is over the guide and not excused; `undefined` under it, on a split
// filing, with the reason declared, or with no parsable estimate. `issue:file` and `backlog:next` both
// judge through it (joshuafolkken/kit#5384).
function over_guide(
	body: string,
	route: string | undefined,
	rate?: ImplementRate,
): SizeMeasurement | undefined {
	return is_excused(body, route) ? undefined : guide_exceeded(body, rate)
}

// joshuafolkken/kit#5935: a split filing passes the guide at filing, yet a lane still lands past its
// doubled declaration, so `backlog:next` warns on the declared estimate of a split child over the
// guide; `undefined` under it, on any other route, or with no parsable estimate.
function split_over_guide(
	body: string,
	route: string | undefined,
	rate?: ImplementRate,
): SizeMeasurement | undefined {
	return route === SPLIT_ROUTE_LABEL ? guide_exceeded(body, rate) : undefined
}

// The declared estimate when it is over the cap; a declared reason does not excuse it, only a split
// filing does (joshuafolkken/kit#5502). `issue:file` and `backlog:next` both judge through it.
function over_cap(
	body: string,
	route: string | undefined,
	rate?: ImplementRate,
): SizeMeasurement | undefined {
	const estimate = parse(body, rate)

	if (estimate === undefined || route === SPLIT_ROUTE_LABEL) return undefined

	return split_assess.is_over_cap(grown(estimate.files), grown(estimate.lines), guide_for(rate))
		? estimate
		: undefined
}

// The filing route a row's labels carry — the split route, or none.
function route_of(labels: ReadonlyArray<string>): string | undefined {
	return labels.includes(SPLIT_ROUTE_LABEL) ? SPLIT_ROUTE_LABEL : undefined
}

// Whether an open Issue is declared over the cap — `backlog:next`, `auto-ok:next` and the idle
// notice all hold it for a person through this one check.
function is_issue_over_cap(
	issue: Pick<OpenIssueData, 'body' | 'labels'>,
	rate?: ImplementRate,
): boolean {
	const labels = issue.labels?.map((label) => label.name) ?? []

	return over_cap(issue.body ?? '', route_of(labels), rate) !== undefined
}

// The counts against the cap, shared by the filing refusal and `backlog:next`'s withheld note.
function capped(estimate: SizeMeasurement, rate?: ImplementRate): string {
	const { cap } = guide_for(rate)

	return `${projected(estimate)} exceeds the cap (more than ${String(cap.files)} files or ${String(cap.lines)} lines), which \`${REASON_PREFIX}\` does not excuse`
}

function cap_refusal(estimate: SizeMeasurement, rate?: ImplementRate): string {
	return `${capped(estimate, rate)} — file an ordered epic of \`--route split\` children instead (the mechanical changes first, the child that switches the setting on last); split-assessment.md → "${split_assess.QUESTION_SECTION}"`
}

// The implement minutes the grown declared lines take at the measured rate.
function projected_minutes(estimate: SizeMeasurement, rate: ImplementRate): number {
	return lane_implement_rate.minutes_for(grown(estimate.lines), rate)
}

function budget_refusal(estimate: SizeMeasurement, rate: ImplementRate): string {
	const minutes = Math.round(projected_minutes(estimate, rate))
	const measured = `${rate.median.toFixed(1)} implement min / 100 lines over ${String(rate.lanes)} lane(s)`

	return `${exceeded(estimate, rate)} and projects ${String(minutes)} implement minute(s) at ${measured}, over the ${String(IMPLEMENT_BUDGET)}-minute implement budget, which \`${REASON_PREFIX}\` does not excuse — file it split (\`--route split\`); split-assessment.md → "${split_assess.QUESTION_SECTION}"`
}

// joshuafolkken/kit#6025: an estimate whose projected implement time exceeds the stage
// budget, reason declared or not — the filing refuses it and `backlog:next` notes it
// (joshuafolkken/kit#6066); `undefined` for a split filing, with no measured rate, or
// within the budget.
function over_budget(
	body: string,
	route: string | undefined,
	rate: ImplementRate | undefined,
): SizeMeasurement | undefined {
	const estimate = route === SPLIT_ROUTE_LABEL ? undefined : parse(body, rate)

	if (estimate === undefined || rate === undefined) return undefined

	return projected_minutes(estimate, rate) > IMPLEMENT_BUDGET ? estimate : undefined
}

function budget_problem(
	body: string,
	route: string | undefined,
	rate: ImplementRate | undefined,
): string | undefined {
	const estimate = over_budget(body, route, rate)

	return estimate === undefined || rate === undefined ? undefined : budget_refusal(estimate, rate)
}

// The filing refusal for an estimate over the cap, else over the implement budget at `rate`, else over
// the guide. A missing or malformed estimate is `problems`' refusal, not this one.
function guide_problem(
	body: string,
	route: string | undefined,
	rate?: ImplementRate,
): string | undefined {
	const over = over_cap(body, route, rate)

	if (over !== undefined) return cap_refusal(over, rate)
	const estimate = over_guide(body, route, rate)
	const guide_refusal = estimate === undefined ? undefined : refusal(estimate, rate)

	return budget_problem(body, route, rate) ?? guide_refusal
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
	over_budget,
	over_cap,
	over_guide,
	problems,
	projected_minutes,
	restated,
	route_of,
	split_over_guide,
	stated_line,
}

export { size_estimate }
