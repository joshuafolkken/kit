import { figure_format } from '#scripts/lib/figure-format'
import type { Audit, AuditRow } from './cost-audit'
import { cost_audit_rewrite, type RewriteCount } from './cost-audit-rewrite'

// The printed form of a `josh cost:audit` result: the full report the command prints, and the one
// summary line `josh retrospective` carries so a run's digest shows the trend it ran in.

const PERCENT = 100
const PERCENT_DECIMALS = 1
const REGRESSION_MARK = '  regression'
const NO_PREVIOUS = 'new'

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
		{ name: 'kind', title: 'By session kind', rows: audit.kinds },
		{ name: 'tool', title: 'By tool category', rows: audit.tools },
		{ name: 'guard', title: 'By guard (refusal and Stop round trips)', rows: audit.guards },
	]
}

function merge_lines(audit: Audit): Array<string> {
	if (audit.merges === undefined) return ['  merges: not read from GitHub']

	const counts = `  merges: ${String(audit.merges.current)} (prev ${String(audit.merges.previous)})`

	return audit.per_merge === undefined ? [counts] : [counts, row_line(audit.per_merge)]
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

function section_lines(section: AuditSection): Array<string> {
	const body = section.rows.length === 0 ? ['  none'] : section.rows.map((row) => row_line(row))

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
		...sections_of(audit).flatMap((section) => section_lines(section)),
		...rewrite_lines(audit),
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

	return [`File a cost regression: ${names.join(', ')} — reproduce with \`pnpm josh cost:audit\``]
}

const cost_audit_format = { filing_lines, report_lines, summary_line }

export { cost_audit_format }
