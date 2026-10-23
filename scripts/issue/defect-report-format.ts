import { defect_report, type DefectReport } from './defect-report'
import { issue_cite } from './issue-cite'

// The printed `defect:report`: each grouping as a table of counts, largest first.

const INDENT = '  '
const NONE = `${INDENT}(none)`

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
	return issue_cite.plain(pr)
}

function summary(report: DefectReport): string {
	let traced = 0

	for (const count of report.by_pr.values()) traced += count
	const parts = [
		`traced to a pull request: ${String(traced)}`,
		`不明: ${String(report.unknown)}`,
		`no origin line: ${String(report.undeclared)}`,
	]

	return `defects by origin — ${parts.join(' · ')}`
}

function format(report: DefectReport): string {
	const week = `pull requests that added a mechanism — defects filed within ${String(defect_report.WEEK_DAYS)} days of the merge:`

	return [
		summary(report),
		...section('by pull request:', report.by_pr, pr_label),
		...section('by change kind (add / fix / remove):', report.by_kind, String),
		...section('by area:', report.by_area, String),
		...section(week, report.added_within_week, pr_label),
	].join('\n')
}

const defect_report_format = { format }

export { defect_report_format }
