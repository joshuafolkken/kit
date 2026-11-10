import { figure_format } from '#scripts/lib/figure-format'
import type { Audit, AuditRow } from './cost-audit'
import { cost_audit_density, type Density } from './cost-audit-density'
import type { PhaseRow } from './cost-audit-phase'
import { cost_audit_rewrite, type RewriteCount } from './cost-audit-rewrite'
import { cost_audit_spend, type ModelSpend } from './cost-audit-spend'
import {
	cost_audit_usage,
	type AgentRuns,
	type FirstContext,
	type LongOutput,
	type UsageBreakdown,
} from './cost-audit-usage'

// The printed form of a `josh cost:audit` result: the full report the command prints, and the one
// summary line `josh retrospective` carries so a run's digest shows the trend it ran in.

const PERCENT = 100
const PERCENT_DECIMALS = 1
const CALLS_PER_RUN_DECIMALS = 1
const REGRESSION_MARK = '  regression'
const NO_PREVIOUS = 'new'
// The filing line's frame, shared with the retrospective's picks, which parse the row names back out.
const FILING_PREFIX = 'File a cost regression: '
const FILING_ROW_SEPARATOR = ', '
const FILING_SUFFIX = ' — reproduce with `pnpm josh cost:audit`'
// Each row's model lines follow it, indented: the same four token types in dollars.
const KIND_TITLE =
	'By session kind (this period per model: cost — input / cache read / cache write / output in dollars)'
const PHASE_TITLE =
	'Lane children by phase (this period: cost — billed input / cache read / cache write / output tokens; per model in dollars)'
const AGENT_TITLE =
	'Lane subagents by agent type (this period: cost — billed input / cache read / cache write / output tokens; per model in dollars)'

interface AuditSection {
	name: string
	title: string
	rows: ReadonlyArray<AuditRow>
}

function change(row: AuditRow): string {
	if (row.previous === 0) return NO_PREVIOUS

	const share = ((row.current - row.previous) / row.previous) * PERCENT
	const sign = share >= 0 ? '+' : ''

	return `${sign}${share.toFixed(PERCENT_DECIMALS)}%`
}

function row_line(row: AuditRow): string {
	const figures = `${figure_format.format_usd(row.current)} (prev ${figure_format.format_usd(row.previous)}, ${change(row)})`

	return `  ${row.key}: ${figures}${row.is_regression ? REGRESSION_MARK : ''}`
}

function sections_of(audit: Audit): Array<AuditSection> {
	return [
		{ name: 'kind', title: KIND_TITLE, rows: audit.kinds },
		{ name: 'tool', title: 'By tool category', rows: audit.tools },
		{ name: 'guard', title: 'By guard (refusal and Stop round trips)', rows: audit.guards },
	]
}

function merge_lines(audit: Audit): Array<string> {
	if (audit.merges === undefined) return ['  merges: not read from GitHub']

	const counts = `  merges: ${String(audit.merges.current)} (prev ${String(audit.merges.previous)})`

	return audit.per_merge === undefined ? [counts] : [counts, row_line(audit.per_merge)]
}

const DENSITY_DECIMALS = 2

function density_text(density: Density): string {
	const calls = cost_audit_density.calls_per_request(density).toFixed(DENSITY_DECIMALS)
	const single = (cost_audit_density.single_share(density) * PERCENT).toFixed(PERCENT_DECIMALS)

	return `${calls} calls/request, ${single}% single-call`
}

// The lane children's round-trip density, the figure a batching change is read against (kit#5342).
function density_line(audit: Audit): string {
	const { current, previous } = audit.lane_density

	return `  lane-child density: ${density_text(current)} (prev ${density_text(previous)})`
}

// The period's lane-child calls per request alone — `cost:audit --density`'s output, a number a
// measurement Issue declares because it is the output's last line (`measure-declaration.ts`). A period
// with no lane-child request answers `undefined`, never a zero that would pass a declared bound.
function density_value(audit: Audit): string | undefined {
	const { current } = audit.lane_density

	if (current.requests === 0) return undefined

	return cost_audit_density.calls_per_request(current).toFixed(DENSITY_DECIMALS)
}

function rewrite_figures(count: RewriteCount): string {
	return `${String(count.count)} (${figure_format.format_usd(count.usd)})`
}

function rewrite_line(label: string, current: RewriteCount, previous: RewriteCount): string {
	return `  ${label}: ${rewrite_figures(current)} (prev ${rewrite_figures(previous)})`
}

// The full cache rewrites, set beside the period before so a change to the waits shows as a count.
function rewrite_lines(audit: Audit): Array<string> {
	const { current, previous } = audit.rewrites
	const floor = String(cost_audit_rewrite.REWRITE_FLOOR_TOKENS)

	return [
		'',
		`Full cache rewrites (cache write over ${floor} tokens, the earlier context not read back)`,
		rewrite_line('after a wait of 5 min or more', current.after_wait, previous.after_wait),
		rewrite_line('within 5 min', current.within_ttl, previous.within_ttl),
	]
}

function phase_line(row: PhaseRow): string {
	const { input, cache_read, cache_write, output } = row.tokens
	const tokens = [input, cache_read, cache_write, output].map((count) =>
		figure_format.format_tokens(count),
	)

	return `  ${row.key}: ${figure_format.format_usd(row.usd)} — ${tokens.join(' / ')}`
}

// One model's share of a row, its dollars by token type in the order the row's tokens are printed.
function spend_line(spend: ModelSpend): string {
	const terms = [spend.input, spend.cache_read, spend.cache_write, spend.output].map((usd) =>
		figure_format.format_usd(usd),
	)
	const total = figure_format.format_usd(cost_audit_spend.total_of(spend))

	return `    ${spend.model}: ${total} — ${terms.join(' / ')}`
}

function phase_row_lines(row: PhaseRow): Array<string> {
	return [phase_line(row), ...row.models.map((spend) => spend_line(spend))]
}

function token_table_lines(title: string, rows: ReadonlyArray<PhaseRow>): Array<string> {
	const body = rows.length === 0 ? ['  none'] : rows.flatMap((row) => phase_row_lines(row))

	return ['', title, ...body]
}

// The current period's lane requests by phase (joshuafolkken/kit#5936) and the lane's delegated units by
// agent type (joshuafolkken/kit#5971), set apart from the regression rows: each is read against a change
// aimed at one phase or one agent, not filed on.
function phase_lines(audit: Audit): Array<string> {
	return [
		...token_table_lines(PHASE_TITLE, audit.phases),
		...token_table_lines(AGENT_TITLE, audit.agents),
	]
}

function tokens_usd(tokens: number, usd: number): string {
	return `${figure_format.format_tokens(tokens)} tokens (${figure_format.format_usd(usd)})`
}

function first_text(first: FirstContext, unit: string): string {
	const p50 =
		first.p50_tokens === undefined ? 'none' : figure_format.format_tokens(first.p50_tokens)

	return `${p50} (${String(first.sessions)} ${unit})`
}

function long_output_line(long: LongOutput): string {
	const share = long.all_calls === 0 ? 0 : (long.calls / long.all_calls) * PERCENT
	const counts = `${String(long.calls)} of ${String(long.all_calls)} calls`

	return `  output over ${String(cost_audit_usage.LONG_OUTPUT_TOKENS)} tokens: ${counts} (${share.toFixed(PERCENT_DECIMALS)}%, ${figure_format.format_usd(long.usd)})`
}

function agent_runs_line(agent: AgentRuns): string {
	const per_run = (agent.calls / agent.runs).toFixed(CALLS_PER_RUN_DECIMALS)

	return `    ${agent.agent_type}: ${String(agent.runs)} runs, ${per_run} calls/run, ${figure_format.format_usd(agent.usd)}`
}

// The current period's usage breakdown (joshuafolkken/kit#7042): the figures a cost-reduction Issue
// sets its before and after on, read beside the dollar rows rather than filed on.
function usage_lines(usage: UsageBreakdown): Array<string> {
	const { cache_write: write } = usage
	const agents =
		usage.agents.length === 0 ? ['    none'] : usage.agents.map((agent) => agent_runs_line(agent))

	return [
		'',
		'Usage breakdown (this period: tokens and dollars)',
		`  cache write 5m: ${tokens_usd(write.tokens_5m, write.usd_5m)} / 1h: ${tokens_usd(write.tokens_1h, write.usd_1h)}`,
		`  first request context p50: main ${first_text(usage.first_main, 'sessions')} / subagent ${first_text(usage.first_subagent, 'runs')}`,
		long_output_line(usage.long_output),
		'  subagent runs by agent type:',
		...agents,
	]
}

// A row and, on the kind rows, its current-period model lines.
function row_lines(row: AuditRow): Array<string> {
	return [row_line(row), ...(row.models ?? []).map((spend) => spend_line(spend))]
}

function section_lines(section: AuditSection): Array<string> {
	const body =
		section.rows.length === 0 ? ['  none'] : section.rows.flatMap((row) => row_lines(row))

	return ['', section.title, ...body]
}

// Every flagged row, named by its section so `doc read` the tool and a guard of the same name differ.
function regression_names(audit: Audit): Array<string> {
	const head = [audit.total, audit.per_merge]
		.filter((row): row is AuditRow => row?.is_regression === true)
		.map((row) => row.key)
	const named = sections_of(audit).flatMap((section) =>
		section.rows.filter((row) => row.is_regression).map((row) => `${section.name} ${row.key}`),
	)

	return [...head, ...named]
}

function regression_text(audit: Audit): string {
	const names = regression_names(audit)

	return names.length === 0 ? 'none' : names.join(', ')
}

function report_lines(audit: Audit): Array<string> {
	const days = String(audit.days)

	return [
		`Cost audit — the last ${days} day(s) against the ${days} before`,
		row_line(audit.total),
		...merge_lines(audit),
		density_line(audit),
		...sections_of(audit).flatMap((section) => section_lines(section)),
		...rewrite_lines(audit),
		...phase_lines(audit),
		...usage_lines(audit.usage),
		'',
		`Regressions: ${regression_text(audit)}`,
	]
}

function summary_line(audit: Audit): string {
	const total = `${figure_format.format_usd(audit.total.current)} (${change(audit.total)})`
	const merge =
		audit.per_merge === undefined
			? ''
			: `, ${figure_format.format_usd(audit.per_merge.current)} per merge`

	return `Cost audit (${String(audit.days)}d): ${total}${merge}; regressions: ${regression_text(audit)}`
}

// A regression is a filing the retrospective owes, not a figure to weigh (`retrospective.md`), so the
// digest names it as one; a period with none adds nothing.
function filing_lines(audit: Audit): Array<string> {
	const names = regression_names(audit)

	if (names.length === 0) return []

	return [FILING_PREFIX + names.join(FILING_ROW_SEPARATOR) + FILING_SUFFIX]
}

const cost_audit_format = {
	FILING_PREFIX,
	FILING_ROW_SEPARATOR,
	FILING_SUFFIX,
	density_value,
	filing_lines,
	report_lines,
	summary_line,
}

export { cost_audit_format }
