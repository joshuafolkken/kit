import { cost_composition, type Composition } from './cost-composition'
import { cost_curve, type CapSimulation, type Curve } from './cost-curve'
import { cost_format } from './cost-format'
import { cost_pricing, type ModelCost } from './cost-pricing'
import { cost_resident, type ResidentBreakdown } from './cost-resident'
import { cost_usage, type UsageRecord, type UsageTotals } from './cost-usage'

// Turning per-request usage into the report a person reads and joshuafolkken/kit#921 cites
// (joshuafolkken/kit#962).

// Where the billed input went. A session's resident baseline is its first request's whole input —
// system prompt, tool schemas, `CLAUDE.md`, the skills index — because that is what was in context
// before any work had happened. Every later request re-reads it, so what a session paid for the
// resident half is that baseline times its request count, and the conversation is the remainder.
//
// The baseline belongs to the **session**, never to a filtered set of records: the first record of
// an issue's slice is a warm mid-session request, and reading it as a preamble reported one issue
// as 86.5% resident where the session it came from was 27.7%. So the total is supplied by the
// caller, which knows which session each record came from.
//
// It is an estimate, and named one: the baseline also contains the first user message, and a
// mid-session compaction moves the line. What it is not is a guess — the two shares add up to the
// billed input exactly, so a reader can check it.
interface InputBreakdown {
	// The per-request average of what the scope paid for the resident preamble. For a whole session
	// that is the preamble itself; for a scope spanning sessions it is their mean.
	resident_baseline_tokens: number
	resident_billed_tokens: number
	history_billed_tokens: number
	billed_input_tokens: number
}

// `resident_billed_tokens` is supplied by the caller rather than derived from `records`, because the
// first record of a *filtered* set is not a preamble. A scope spanning sessions has no single
// baseline either, so what the caller passes is each contributing session's own baseline times the
// records it contributed.
function build_breakdown(
	records: ReadonlyArray<UsageRecord>,
	resident_billed_tokens: number,
): InputBreakdown {
	const billed = cost_usage.billed_input(cost_usage.sum_totals(records))
	const resident = Math.min(resident_billed_tokens, billed)

	return {
		resident_baseline_tokens: records.length === 0 ? 0 : Math.round(resident / records.length),
		resident_billed_tokens: resident,
		history_billed_tokens: billed - resident,
		billed_input_tokens: billed,
	}
}

interface MissingData {
	no_usage_lines: number
	malformed_lines: number
	unreadable_sessions: number
	// Delegated units whose owning session's issue could not be determined, so their cost is charged
	// to no issue at all (joshuafolkken/kit#1812). Non-zero makes an issue scope's `cost_usd` a floor,
	// the same reading `unpriced_models` gets one field over. **Zero in the three counters above is not
	// evidence of a complete read**: a run reported `missing` as three zeros while dropping a quarter
	// of its cost, because a unit that attributed to nothing was silence rather than a count — this is
	// the fourth counter that makes that drop visible.
	unattributed_sessions: number
}

// The two decompositions joshuafolkken/kit#1151 added, carried together because they answer the two
// halves of one question: the resident preamble is made of these parts, and the history is made of
// those. Present only on a whole-session scope — both are read from one transcript's own lines, and
// an issue's slice or a `--all` corpus has no single session to read.
interface Measurement {
	resident: ResidentBreakdown
	composition: Composition
}

interface CostReport {
	scope: string
	request_count: number
	totals: UsageTotals
	by_model: Array<ModelCost>
	cost_usd: number
	// Model ids the price table does not know. Non-empty means `cost_usd` is a floor, not the total.
	unpriced_models: Array<string>
	breakdown: InputBreakdown
	missing: MissingData
	measurement?: Measurement
	// The cost curve across request position, and — only when a cap was requested — the share of the
	// run's cost that fell at or under it (joshuafolkken/kit#1838). Both absent on an empty scope.
	curve?: Curve
	cap_simulation?: CapSimulation
}

interface ReportInput {
	scope: string
	records: ReadonlyArray<UsageRecord>
	missing: MissingData
	resident_billed_tokens: number
	measurement?: Measurement
	cap_tokens?: number
}

// `exactOptionalPropertyTypes` rejects `{ measurement: undefined }`, so an absent measurement
// contributes no key at all — the same idiom the CLI's optional flags use.
function optional_measurement(measurement: Measurement | undefined): { measurement?: Measurement } {
	return measurement === undefined ? {} : { measurement }
}

// `curve` is computed for every non-empty scope; `cap_simulation` only when a cap was requested.
// Both follow the same absent-key idiom so a scope with no data carries neither.
function optional_curve(records: ReadonlyArray<UsageRecord>): { curve?: Curve } {
	return records.length === 0 ? {} : { curve: cost_curve.build_curve(records) }
}

function optional_cap(
	records: ReadonlyArray<UsageRecord>,
	cap_tokens: number | undefined,
): { cap_simulation?: CapSimulation } {
	if (cap_tokens === undefined || records.length === 0) return {}

	return { cap_simulation: cost_curve.simulate_cap(records, cap_tokens) }
}

function build_report(input: ReportInput): CostReport {
	const by_model = cost_pricing.cost_by_model(input.records)
	const { usd, unpriced } = cost_pricing.total_cost(by_model)

	return {
		scope: input.scope,
		request_count: input.records.length,
		totals: cost_usage.sum_totals(input.records),
		by_model,
		cost_usd: usd,
		unpriced_models: unpriced,
		breakdown: build_breakdown(input.records, input.resident_billed_tokens),
		missing: input.missing,
		...optional_measurement(input.measurement),
		...optional_curve(input.records),
		...optional_cap(input.records, input.cap_tokens),
	}
}

function token_lines(totals: UsageTotals): Array<string> {
	return [
		`  uncached input   ${cost_format.format_tokens(totals.input_tokens)}`,
		`  cache write 5m   ${cost_format.format_tokens(totals.cache_write_5m_tokens)}  (x${String(cost_pricing.CACHE_WRITE_5M_MULTIPLIER)})`,
		`  cache write 1h   ${cost_format.format_tokens(totals.cache_write_1h_tokens)}  (x${String(cost_pricing.CACHE_WRITE_1H_MULTIPLIER)})`,
		`  cache read       ${cost_format.format_tokens(totals.cache_read_tokens)}  (x${String(cost_pricing.CACHE_READ_MULTIPLIER)})`,
		`  output           ${cost_format.format_tokens(totals.output_tokens)}  (of which thinking ${cost_format.format_tokens(totals.thinking_tokens)})`,
	]
}

function breakdown_lines(breakdown: InputBreakdown): Array<string> {
	const billed = breakdown.billed_input_tokens

	return [
		`  resident (system prompt + CLAUDE.md, re-read every request)  ${cost_format.format_tokens(breakdown.resident_billed_tokens)}  ${cost_format.format_share(breakdown.resident_billed_tokens, billed)}`,
		`  conversation history                                        ${cost_format.format_tokens(breakdown.history_billed_tokens)}  ${cost_format.format_share(breakdown.history_billed_tokens, billed)}`,
		`  resident baseline, per request                              ${cost_format.format_tokens(breakdown.resident_baseline_tokens)}`,
	]
}

function model_lines(by_model: ReadonlyArray<ModelCost>): Array<string> {
	return by_model.map(
		(entry) =>
			`  ${entry.model}  ${entry.cost_usd === undefined ? 'unpriced (unknown model)' : cost_format.format_usd(entry.cost_usd)}`,
	)
}

// The counters and how each one reads, in the order they print. Data-driven so a fifth counter is a
// row here rather than another branch in the formatter.
const MISSING_LABELS: ReadonlyArray<readonly [keyof MissingData, string]> = [
	['malformed_lines', 'unparseable lines'],
	['no_usage_lines', 'assistant lines without usage'],
	['unreadable_sessions', 'unreadable sessions'],
	['unattributed_sessions', 'delegated units not attributed to an issue'],
]

// The one counter whose presence makes a scope's cost incomplete: an unattributed delegated unit's
// cost is charged to no issue, so an issue scope reporting one is a floor (joshuafolkken/kit#1812).
const FLOOR_KEY: keyof MissingData = 'unattributed_sessions'

function missing_row(key: keyof MissingData, label: string, missing: MissingData): string {
	const count = missing[key]

	if (count === 0) return ''

	const floor = key === FLOOR_KEY ? ' (the cost above is a floor)' : ''

	return `  ${label}: ${String(count)}${floor}`
}

// Only ever printed when there is something to say. A silent report is the failure mode this
// command exists to remove, but a "0 malformed lines" row on every clean run is noise.
function missing_lines(missing: MissingData): Array<string> {
	const rows = MISSING_LABELS.map(([key, label]) => missing_row(key, label, missing)).filter(
		(row) => row !== '',
	)

	return rows.length === 0 ? [] : ['', 'Missing data (not counted above):', ...rows]
}

// The two decompositions, and the one sentence that keeps them readable. Printing a table of
// estimates beside a measured total without saying which is which is how an estimate becomes a
// figure someone later quotes as measured.
function measurement_lines(measurement: Measurement | undefined): Array<string> {
	if (measurement === undefined) return []

	return [
		'',
		...cost_resident.format_resident(measurement.resident),
		'',
		...cost_composition.format_composition(measurement.composition),
	]
}

function curve_lines(curve: Curve | undefined): Array<string> {
	return curve === undefined ? [] : cost_curve.format_curve_lines(curve)
}

function cap_lines(cap: CapSimulation | undefined): Array<string> {
	return cap === undefined ? [] : cost_curve.format_cap_lines(cap)
}

function unpriced_lines(models: ReadonlyArray<string>): Array<string> {
	if (models.length === 0) return []

	return ['', `⚠ ${models.join(', ')} is not in the price table; the total above is a floor.`]
}

// The one line a `--all` run ends on: what the whole corpus cost. Kept separate from the per-scope
// reports because summing their `missing` counts would multiply one corpus-wide figure by the
// number of scopes it was reported under.
function format_totals_line(reports: ReadonlyArray<CostReport>): string {
	const requests = reports.reduce((sum, report) => sum + report.request_count, 0)
	const usd = reports.reduce((sum, report) => sum + report.cost_usd, 0)

	return `Total across ${String(reports.length)} scope(s): ${String(requests)} request(s), ${cost_format.format_usd(usd)}`
}

const NOTHING_ATTRIBUTED = [
	'No requests are attributed to this scope. Attribution reads the `<number>-<slug>` branch a',
	'session walked, so a child whose branch does not exist yet — the work is still on the default',
	'branch — has nothing charged to it.',
].join(' ')

// A table of zeroes reads as "this cost nothing", which is the one answer that is never true. An
// empty scope says so in words instead, and still shows what could not be read.
function format_empty(report: CostReport): string {
	const lines = [`${report.scope} — no requests`, '', NOTHING_ATTRIBUTED]

	return [...lines, ...missing_lines(report.missing)].join('\n')
}

function format_report(report: CostReport): string {
	if (report.request_count === 0) return format_empty(report)

	return [
		`${report.scope} — ${String(report.request_count)} request(s), ${cost_format.format_usd(report.cost_usd)}`,
		'',
		'Tokens:',
		...token_lines(report.totals),
		'',
		'Billed input:',
		...breakdown_lines(report.breakdown),
		'',
		'Cost by model:',
		...model_lines(report.by_model),
		...measurement_lines(report.measurement),
		...curve_lines(report.curve),
		...cap_lines(report.cap_simulation),
		...unpriced_lines(report.unpriced_models),
		...missing_lines(report.missing),
	].join('\n')
}

const cost_report = {
	build_breakdown,
	build_report,
	format_usd: cost_format.format_usd,
	format_share: cost_format.format_share,
	format_totals_line,
	format_empty,
	format_report,
}

export type { CostReport, InputBreakdown, Measurement, MissingData, ReportInput }
export { cost_report }
