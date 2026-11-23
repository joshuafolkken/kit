import { defect_report, type AreaRate, type DefectReport } from './defect-report'
import { issue_cite } from './issue-cite'

// The printed `defect:report`: each grouping as a table of counts, largest first, and — for a
// `--since` period — each area's defects over the merges that touched it.

const INDENT = '  '
const NONE = `${INDENT}(none)`
const PERCENT = 100
const DIGEST_TOP_AREAS = 5

interface Period {
	days: number
	rates: ReadonlyArray<AreaRate>
}

function sorted_rows<K>(counts: ReadonlyMap<K, number>, label: (key: K) => string): Array<string> {
	return [...counts]
		.toSorted((left, right) => right[1] - left[1])
		.map(([key, count]) => `${INDENT}${label(key)}  ${String(count)}`)
}

function section<K>(
	title: string,
	counts: ReadonlyMap<K, number>,
	label: (key: K) => string,
): Array<string> {
	const rows = sorted_rows(counts, label)

	return [title, ...(rows.length === 0 ? [NONE] : rows)]
}

function pr_label(pr: number): string {
	return issue_cite.plain_for('linked', pr)
}

function percent(part: number, total: number): string {
	return total === 0 ? '0%' : `${String(Math.round((part / total) * PERCENT))}%`
}

function share(count: number, total: number): string {
	return `${String(count)} (${percent(count, total)})`
}

// Each origin-line kind's count with its share of the counted defects.
function summary(report: DefectReport): string {
	let traced = 0

	for (const count of report.by_pr.values()) traced += count
	const total = traced + report.unknown + report.undeclared
	const parts = [
		`traced to a pull request: ${share(traced, total)}`,
		`不明: ${share(report.unknown, total)}`,
		`no origin line: ${share(report.undeclared, total)}`,
	]

	return `defects by origin — ${parts.join(' · ')}`
}

function rate_row(rate: AreaRate): string {
	return `${INDENT}${rate.area}  ${String(rate.defects)} / ${String(rate.merges)}  ${percent(rate.defects, rate.merges)}`
}

function rate_section(period: Period): Array<string> {
	const title = `defect rate by area — defects / merges in the last ${String(period.days)} days:`
	const rows = period.rates.map((rate) => rate_row(rate))

	return [title, ...(rows.length === 0 ? [NONE] : rows)]
}

function format(report: DefectReport, period?: Period): string {
	const week = `pull requests that added a mechanism — defects filed within ${String(defect_report.WEEK_DAYS)} days of the merge:`

	return [
		summary(report),
		...section('by pull request:', report.by_pr, pr_label),
		...section('by change kind (add / fix / remove):', report.by_kind, String),
		...section('by area:', report.by_area, String),
		...section(week, report.added_within_week, pr_label),
		...(period === undefined ? [] : rate_section(period)),
	].join('\n')
}

// The retrospective's section: the period's origin-line coverage and its highest-rate areas.
function digest(report: DefectReport, period: Period): ReadonlyArray<string> {
	const top = period.rates.filter((rate) => rate.defects > 0).slice(0, DIGEST_TOP_AREAS)

	return [
		`Defects (last ${String(period.days)} days): ${summary(report)}`,
		...(top.length === 0 ? [NONE] : top.map((rate) => rate_row(rate))),
	]
}

const defect_report_format = { digest, format }

export type { Period }
export { defect_report_format }
