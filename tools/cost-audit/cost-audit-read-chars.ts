import { cost_audit, type AuditWindow } from './cost-audit'
import { cost_audit_format } from './cost-audit-format'
import type { AuditSession } from './cost-audit-read'
import { cost_audit_result, type ResultChars } from './cost-audit-result'

// `cost:audit --read-chars <path>` and `--lane-read-chars` — the period's Read chars as one number on
// the output's last line, so an Issue's measurement declaration can compare a document's reads before and after a
// change (joshuafolkken/kit#8834). Both read the Read-file rows `cost:audit`'s breakdown prints, so
// the number is the table's own sum; a period with no matching read prints nothing, never a zero a
// declared bound would read as met.

const PATH_SEPARATOR = '/'
const { utc_range } = cost_audit_format

function read_rows(
	sessions: ReadonlyArray<AuditSession>,
	window: AuditWindow,
): ReadonlyArray<ResultChars> {
	return cost_audit_result.breakdown_of(cost_audit.inside(sessions, window)).reads
}

function chars_sum(rows: ReadonlyArray<ResultChars>): number {
	return rows.reduce((sum, row) => sum + row.chars, 0)
}

// A row's key is the main checkout's absolute path; the repository-relative path matches its tail.
function is_path_of(key: string, path: string): boolean {
	return key === path || key.endsWith(`${PATH_SEPARATOR}${path}`)
}

// The period's Read chars of one file, as a label line over the number.
function file_lines(
	sessions: ReadonlyArray<AuditSession>,
	window: AuditWindow,
	path: string,
): Array<string> {
	const rows = read_rows(sessions, window).filter((row) => is_path_of(row.key, path))

	if (rows.length === 0) return []

	return [`Read chars of ${path} ${utc_range(window)}`, String(chars_sum(rows))]
}

// The distinct lane Issues with a transcript line inside the period.
function issue_count(sessions: ReadonlyArray<AuditSession>): number {
	const active = sessions.filter((session) => session.lines.length > 0)
	const issues = new Set(active.map((session) => session.issue))

	issues.delete(undefined)

	return issues.size
}

// The lane children's Read chars of the period divided by the lane Issues they ran for.
function lane_lines(sessions: ReadonlyArray<AuditSession>, window: AuditWindow): Array<string> {
	const cut = cost_audit.inside(sessions, window)
	const issues = issue_count(cut)

	if (issues === 0) return []

	const per_issue = Math.round(chars_sum(cost_audit_result.breakdown_of(cut).reads) / issues)

	return [`lane-child Read chars per lane Issue ${utc_range(window)}`, String(per_issue)]
}

const cost_audit_read_chars = { file_lines, lane_lines }

export { cost_audit_read_chars }
