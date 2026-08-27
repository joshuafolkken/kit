import { cost_pricing, type ModelCost } from './cost-pricing'
import { cost_usage, type UsageRecord, type UsageTotals } from './cost-usage'

// Turning per-request usage into the report a person reads and joshuafolkken/kit#921 cites
// (joshuafolkken/kit#962).

const USD_DECIMALS = 4
const PERCENT_SCALE = 100
const PERCENT_DECIMALS = 1

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
}

interface ReportInput {
	scope: string
	records: ReadonlyArray<UsageRecord>
	missing: MissingData
	resident_billed_tokens: number
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
	}
}

function format_usd(usd: number): string {
	return `$${usd.toFixed(USD_DECIMALS)}`
}

function format_share(part: number, whole: number): string {
	if (whole === 0) return 'n/a'

	return `${((part / whole) * PERCENT_SCALE).toFixed(PERCENT_DECIMALS)}%`
}

function format_tokens(count: number): string {
	return count.toLocaleString('en-US')
}

function token_lines(totals: UsageTotals): Array<string> {
	return [
		`  uncached input   ${format_tokens(totals.input_tokens)}`,
		`  cache write 5m   ${format_tokens(totals.cache_write_5m_tokens)}  (x${String(cost_pricing.CACHE_WRITE_5M_MULTIPLIER)})`,
		`  cache write 1h   ${format_tokens(totals.cache_write_1h_tokens)}  (x${String(cost_pricing.CACHE_WRITE_1H_MULTIPLIER)})`,
		`  cache read       ${format_tokens(totals.cache_read_tokens)}  (x${String(cost_pricing.CACHE_READ_MULTIPLIER)})`,
		`  output           ${format_tokens(totals.output_tokens)}  (of which thinking ${format_tokens(totals.thinking_tokens)})`,
	]
}

function breakdown_lines(breakdown: InputBreakdown): Array<string> {
	const billed = breakdown.billed_input_tokens

	return [
		`  resident (system prompt + CLAUDE.md, re-read every request)  ${format_tokens(breakdown.resident_billed_tokens)}  ${format_share(breakdown.resident_billed_tokens, billed)}`,
		`  conversation history                                        ${format_tokens(breakdown.history_billed_tokens)}  ${format_share(breakdown.history_billed_tokens, billed)}`,
		`  resident baseline, per request                              ${format_tokens(breakdown.resident_baseline_tokens)}`,
	]
}

function model_lines(by_model: ReadonlyArray<ModelCost>): Array<string> {
	return by_model.map(
		(entry) =>
			`  ${entry.model}  ${entry.cost_usd === undefined ? 'unpriced (unknown model)' : format_usd(entry.cost_usd)}`,
	)
}

// Only ever printed when there is something to say. A silent report is the failure mode this
// command exists to remove, but a "0 malformed lines" row on every clean run is noise.
function missing_lines(missing: MissingData): Array<string> {
	const rows = [
		missing.malformed_lines > 0 ? `  unparseable lines: ${String(missing.malformed_lines)}` : '',
		missing.no_usage_lines > 0
			? `  assistant lines without usage: ${String(missing.no_usage_lines)}`
			: '',
		missing.unreadable_sessions > 0
			? `  unreadable sessions: ${String(missing.unreadable_sessions)}`
			: '',
	].filter((row) => row !== '')

	return rows.length === 0 ? [] : ['', 'Missing data (not counted above):', ...rows]
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

	return `Total across ${String(reports.length)} scope(s): ${String(requests)} request(s), ${format_usd(usd)}`
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
		`${report.scope} — ${String(report.request_count)} request(s), ${format_usd(report.cost_usd)}`,
		'',
		'Tokens:',
		...token_lines(report.totals),
		'',
		'Billed input:',
		...breakdown_lines(report.breakdown),
		'',
		'Cost by model:',
		...model_lines(report.by_model),
		...unpriced_lines(report.unpriced_models),
		...missing_lines(report.missing),
	].join('\n')
}

const cost_report = {
	build_breakdown,
	build_report,
	format_usd,
	format_share,
	format_totals_line,
	format_empty,
	format_report,
}

export type { CostReport, InputBreakdown, MissingData, ReportInput }
export { cost_report }
