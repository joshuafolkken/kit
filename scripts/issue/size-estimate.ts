import { lane_implement_rate, type ImplementRate } from '#scripts/lane/lane-implement-rate'
import type { SizeRatios } from '#scripts/lane/lane-size-stats'
import { lane_stage_budget } from '#scripts/lane/lane-stage-budget'
import { declared_growth } from '#scripts/split/declared-growth'
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
// Each axis grows by the recent merged lanes' median, independently of the implement rate.
// `parse` keeps the declared counts: `lane:plan` reads them as declared.

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
const IMPLEMENT_BUDGET = lane_stage_budget.BUDGET_MINUTES.implement
// joshuafolkken/kit#7074: the size bar is twice the implement budget — below it, a split adds a lane's
// fixed stages, which cost more than the implement minutes it saves.
const BAR_BUDGETS = 2
const BAR_MINUTES = BAR_BUDGETS * IMPLEMENT_BUDGET

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
function grown(count: number, axis: 'files' | 'lines', growth?: SizeRatios): number {
	return count * declared_growth.factor(growth, axis)
}

function guide_for(rate?: ImplementRate): ReturnType<typeof split_assess.guide_for> {
	return split_assess.guide_for(IMPLEMENT_BUDGET, rate)
}

// The declared estimate, its verdict judged on the grown counts, or `undefined` when there is none or
// it does not parse.
function parse(
	body: string,
	rate?: ImplementRate,
	growth?: SizeRatios,
): SizeMeasurement | undefined {
	const read = estimate_schema.safeParse(VALUE_PATTERN.exec(declared(body, PREFIX) ?? '')?.groups)

	if (!read.success) return undefined
	const { files, lines } = read.data

	return {
		files,
		lines,
		verdict: split_assess.verdict_for(
			grown(files, 'files', growth),
			grown(lines, 'lines', growth),
			guide_for(rate),
		),
	}
}

// The declared counts, the factor and the grown counts, as every refusal prints them.
function growth_text(growth?: SizeRatios): string {
	return growth?.files === undefined && growth?.lines === undefined
		? `× ${String(declared_growth.factor(growth, 'files'))}`
		: `(${declared_growth.text(growth)})`
}

function projected(estimate: SizeMeasurement, growth?: SizeRatios): string {
	const declared_counts = `${String(estimate.files)} file(s) / ${String(estimate.lines)} line(s)`
	const grown_counts = `${String(grown(estimate.files, 'files', growth))} file(s) / ${String(grown(estimate.lines, 'lines', growth))} line(s)`

	return `size estimate ${declared_counts} ${growth_text(growth)} = ${grown_counts}`
}

// The shape check `issue:lint` makes: the declaration is there and parses. The guide needs the route,
// which only `issue:file` knows, so it is `guide_problem`'s.
function problems(body: string): ReadonlyArray<string> {
	if (is_epic(body)) return []
	if (declared(body, PREFIX) === undefined) return [MISSING]

	return parse(body) === undefined ? [MALFORMED] : []
}

// Whether the body declares why it stays one Issue — the only excuse from the size bar
// (joshuafolkken/kit#7005).
function is_reasoned(body: string): boolean {
	return (declared(body, REASON_PREFIX) ?? '') !== ''
}

// A split filing, or one that declares why it stays one Issue, passes over the guide.
function is_excused(body: string, route: string | undefined): boolean {
	return route === SPLIT_ROUTE_LABEL || is_reasoned(body)
}

// The counts and any guide overrun, shared by filing refusals and `backlog:next`'s offer note.
function exceeded(estimate: SizeMeasurement, rate?: ImplementRate, growth?: SizeRatios): string {
	if (estimate.verdict === split_assess.SINGLE_VERDICT) return projected(estimate, growth)
	const guide = guide_for(rate)

	return `${projected(estimate, growth)} exceeds the guide (more than ${String(guide.files)} files or ${String(guide.lines)} lines)`
}

function refusal(estimate: SizeMeasurement, rate?: ImplementRate, growth?: SizeRatios): string {
	return `${exceeded(estimate, rate, growth)} — file it split (\`--route split\`) or declare \`${REASON_PREFIX} <理由>\`; split-assessment.md → "${split_assess.QUESTION_SECTION}"`
}

// The declared estimate when it is over the guide, whatever excuses it; `undefined` under it or with
// no parsable estimate.
function guide_exceeded(
	body: string,
	rate?: ImplementRate,
	growth?: SizeRatios,
): SizeMeasurement | undefined {
	const estimate = parse(body, rate, growth)

	return estimate?.verdict === split_assess.SPLIT_VERDICT ? estimate : undefined
}

// The declared estimate when it is over the guide and not excused; `undefined` under it, on a split
// filing, with the reason declared, or with no parsable estimate. `issue:file` and `backlog:next` both
// judge through it (joshuafolkken/kit#5384).
function over_guide(
	body: string,
	route: string | undefined,
	rate?: ImplementRate,
	growth?: SizeRatios,
): SizeMeasurement | undefined {
	return is_excused(body, route) ? undefined : guide_exceeded(body, rate, growth)
}

// joshuafolkken/kit#5935: a split filing passes the guide at filing, yet a lane still lands past its
// doubled declaration, so `backlog:next` warns on the declared estimate of a split child over the
// guide; `undefined` under it, on any other route, or with no parsable estimate.
function split_over_guide(
	body: string,
	route: string | undefined,
	rate?: ImplementRate,
	growth?: SizeRatios,
): SizeMeasurement | undefined {
	return route === SPLIT_ROUTE_LABEL ? guide_exceeded(body, rate, growth) : undefined
}

// The declared estimate when it is over the cap (joshuafolkken/kit#5502); a split filing, or a declared
// reason it stays one deliverable — the pre-start split decision — excuses it, as numbers alone never
// force a split (joshuafolkken/kit#6602). `issue:file` and `backlog:next` both judge through it.
function over_cap(
	body: string,
	route: string | undefined,
	rate?: ImplementRate,
	growth?: SizeRatios,
): SizeMeasurement | undefined {
	const estimate = parse(body, rate, growth)

	if (estimate === undefined || is_excused(body, route)) return undefined

	return split_assess.is_over_cap(
		grown(estimate.files, 'files', growth),
		grown(estimate.lines, 'lines', growth),
		guide_for(rate),
	)
		? estimate
		: undefined
}

// The filing route a row's labels carry — the split route, or none.
function route_of(labels: ReadonlyArray<string>): string | undefined {
	return labels.includes(SPLIT_ROUTE_LABEL) ? SPLIT_ROUTE_LABEL : undefined
}

// The counts against the cap, shared by the filing refusal and `backlog:next`'s size note.
function capped(estimate: SizeMeasurement, rate?: ImplementRate, growth?: SizeRatios): string {
	const { cap } = guide_for(rate)

	return `${projected(estimate, growth)} exceeds the cap (more than ${String(cap.files)} files or ${String(cap.lines)} lines) with no \`${REASON_PREFIX}\``
}

function cap_refusal(estimate: SizeMeasurement, rate?: ImplementRate, growth?: SizeRatios): string {
	return `${capped(estimate, rate, growth)} — with separately-mergeable parts, file an ordered epic of \`--route split\` children (the mechanical changes first, the child that switches the setting on last); one deliverable, declare \`${REASON_PREFIX} <理由>\`; split-assessment.md → "${split_assess.QUESTION_SECTION}"`
}

// The implement minutes the grown declared lines take at the measured rate.
function projected_minutes(
	estimate: SizeMeasurement,
	rate: ImplementRate,
	growth?: SizeRatios,
): number {
	return lane_implement_rate.minutes_for(grown(estimate.lines, 'lines', growth), rate)
}

// The most declared lines whose grown count projects within the size bar at `rate` — the one number
// the filing refusal, `lane:plan`'s lines axis and `backlog:next`'s note judge by
// (joshuafolkken/kit#7074); `undefined` with no usable rate.
function declared_lines_bar(rate?: ImplementRate, growth?: SizeRatios): number | undefined {
	const lines = lane_implement_rate.lines_for(BAR_MINUTES, rate)

	return lines === undefined
		? undefined
		: Math.floor(lines / declared_growth.factor(growth, 'lines'))
}

// The declared estimate of a body with no declared reason it stays one deliverable.
function unreasoned(
	body: string,
	rate?: ImplementRate,
	growth?: SizeRatios,
): SizeMeasurement | undefined {
	return is_reasoned(body) ? undefined : parse(body, rate, growth)
}

interface BarOverrun {
	estimate: SizeMeasurement
	rate: ImplementRate
	bar: number
}

// An estimate declaring more lines than the size bar allows (joshuafolkken/kit#6025); `undefined` for
// one declaring why it stays one deliverable (joshuafolkken/kit#6602), with no measured rate, or within
// the bar. A split filing is judged too — its exemption is the guide's alone (joshuafolkken/kit#7005).
function bar_overrun(
	body: string,
	rate: ImplementRate | undefined,
	growth?: SizeRatios,
): BarOverrun | undefined {
	const estimate = unreasoned(body, rate, growth)
	if (estimate === undefined || rate === undefined) return undefined
	const bar = declared_lines_bar(rate, growth)

	return bar !== undefined && estimate.lines > bar ? { estimate, rate, bar } : undefined
}

// The counts against the size bar, shared by the filing refusal and `backlog:next`'s offer note.
function overrun_text(overrun: BarOverrun, growth?: SizeRatios): string {
	const { estimate, rate, bar } = overrun
	const minutes = Math.round(projected_minutes(estimate, rate, growth))
	const measured = `${rate.median.toFixed(1)} implement min / 100 lines over ${String(rate.lanes)} lane(s)`
	const limit = `the ${String(BAR_MINUTES)}-minute size bar (${String(BAR_BUDGETS)} × the ${String(IMPLEMENT_BUDGET)}-minute implement budget: at most ${String(bar)} declared line(s))`

	return `${exceeded(estimate, rate, growth)} and projects ${String(minutes)} implement minute(s) at ${measured}, over ${limit}`
}

// The estimate over the size bar — the filing refuses it; `backlog:next` offers it with a note and the
// lane's `lane:plan` answers `split` on it (joshuafolkken/kit#7074).
function over_budget(
	body: string,
	rate: ImplementRate | undefined,
	growth?: SizeRatios,
): SizeMeasurement | undefined {
	return bar_overrun(body, rate, growth)?.estimate
}

// The note on an estimate over the size bar, or `undefined` within it.
function budget_note(
	body: string,
	rate: ImplementRate | undefined,
	growth?: SizeRatios,
): string | undefined {
	const overrun = bar_overrun(body, rate, growth)

	return overrun === undefined ? undefined : overrun_text(overrun, growth)
}

function budget_problem(
	body: string,
	rate: ImplementRate | undefined,
	growth?: SizeRatios,
): string | undefined {
	const note = budget_note(body, rate, growth)

	return note === undefined
		? undefined
		: `${note} — split it into children each within the bar or declare \`${REASON_PREFIX} <理由>\`; split-assessment.md → "${split_assess.QUESTION_SECTION}"`
}

// The filing refusal for an estimate over the cap, else over the size bar at `rate`, else over
// the guide. A missing or malformed estimate is `problems`' refusal, not this one.
function guide_problem(
	body: string,
	route: string | undefined,
	rate?: ImplementRate,
	growth?: SizeRatios,
): string | undefined {
	const over = over_cap(body, route, rate, growth)

	if (over !== undefined) return cap_refusal(over, rate, growth)
	const estimate = over_guide(body, route, rate, growth)
	const guide_refusal = estimate === undefined ? undefined : refusal(estimate, rate, growth)

	return budget_problem(body, rate, growth) ?? guide_refusal
}

// The declared file count, or `undefined` when there is no estimate or it does not parse.
function declared_files(body: string): number | undefined {
	return parse(body)?.files
}

const size_estimate = {
	budget_note,
	capped,
	declared,
	declared_files,
	declared_lines_bar,
	declared_size: parse,
	exceeded,
	guide_problem,
	is_epic,
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
