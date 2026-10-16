import { cost_format } from '#scripts/cost-runtime/cost-format'
import type { Audit, AuditRow } from './cost-audit'

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
	const figures = `${cost_format.format_usd(row.current)} (prev ${cost_format.format_usd(row.previous)}, ${change(row)})`

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
		'',
		`Regressions: ${regression_text(audit)}`,
	]
}

function summary_line(audit: Audit): string {
	const total = `${cost_format.format_usd(audit.total.current)} (${change(audit.total)})`
	const merge =
		audit.per_merge === undefined
			? ''
			: `, ${cost_format.format_usd(audit.per_merge.current)} per merge`

	return `Cost audit (${String(audit.days)}d): ${total}${merge}; regressions: ${regression_text(audit)}`
}

const cost_audit_format = { report_lines, summary_line }

export { cost_audit_format }
