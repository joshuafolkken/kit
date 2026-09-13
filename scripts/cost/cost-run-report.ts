import { cost_format } from './cost-format'
import type { RunNode } from './cost-run-nodes'
import { cost_run_roles, type RoleTotals, type SessionRow } from './cost-run-roles'
import { cost_run_tree } from './cost-run-tree'
import { cost_transcript } from './cost-transcript'

// The `--run` scope's report: a run tree summed by role, in dollars (joshuafolkken/kit#1937).
//
// It is the axis the hand measurement of 2026-09-13 read and no command could print — what share of
// a whole batch the parent, its lane children, their subagents and the wakes each cost. Merges are
// not derivable from transcripts alone, so that count is reported `not measured` rather than as a
// zero, the same rule the unattributed transcript count follows.

const FAILURE_EXIT_CODE = 1
const OK_EXIT_CODE = 0
const JSON_INDENT = 2
const NOT_MEASURED = 'not measured'
const MS_PER_MINUTE = 60_000
const MINUTE_DIGITS = 1
const ROLE_PAD = 8
const ISSUE_PAD = 6

function format_minutes(ms: number): string {
	return `${(ms / MS_PER_MINUTE).toFixed(MINUTE_DIGITS)} min`
}

interface RunCostReport {
	scope: string
	session_count: number
	run_count: number
	// Merges the run produced, or `undefined` when it could not be read — transcripts carry no record
	// of a merge, so this is `not measured` unless a caller supplies it.
	merged: number | undefined
	unattributed_count: number
	unreadable_count: number
	total_usd: number
	total_elapsed_ms: number
	roles: ReadonlyArray<RoleTotals>
	sessions: ReadonlyArray<SessionRow>
}

function build(
	run_count: number,
	unattributed_count: number,
	nodes: ReadonlyArray<RunNode>,
): RunCostReport {
	const roles = cost_run_roles.build(nodes)

	return {
		scope: 'run tree',
		session_count: nodes.length,
		run_count,
		merged: undefined,
		unattributed_count,
		unreadable_count: roles.unreadable_count,
		total_usd: roles.total_usd,
		total_elapsed_ms: roles.total_elapsed_ms,
		roles: roles.roles,
		sessions: roles.sessions,
	}
}

function count_or_missing(count: number | undefined): string {
	return count === undefined ? NOT_MEASURED : String(count)
}

function header_lines(report: RunCostReport): Array<string> {
	return [
		`run tree — ${String(report.session_count)} session(s), ${format_minutes(report.total_elapsed_ms)} active, ${cost_format.format_usd(report.total_usd)}`,
		`runs in store: ${String(report.run_count)} · merges: ${count_or_missing(report.merged)} · transcripts outside this run: ${String(report.unattributed_count)} · unreadable: ${String(report.unreadable_count)}`,
	]
}

function role_line(role: RoleTotals, report: RunCostReport): string {
	const spent = `${cost_format.format_usd(role.cost_usd)} ${cost_format.format_share(role.cost_usd, report.total_usd)}`
	const time = `${format_minutes(role.elapsed_ms)} ${cost_format.format_share(role.elapsed_ms, report.total_elapsed_ms)}`
	const counts = `${String(role.session_count)} session(s) · ${String(role.request_count)} req · preamble ${cost_format.format_tokens(role.preamble_tokens)}`

	return `  ${role.role.padEnd(ROLE_PAD)} ${spent}  ${time}  ${counts}`
}

function role_lines(report: RunCostReport): Array<string> {
	return [
		'',
		'By role (cost-heaviest first):',
		...report.roles.map((role) => role_line(role, report)),
	]
}

function session_issue(issue: number | undefined): string {
	return issue === undefined ? '—' : `#${String(issue)}`
}

function session_parent(parent_id: string | undefined): string {
	return parent_id === undefined ? '' : ` ← ${parent_id}`
}

function session_line(row: SessionRow): string {
	const tag = `${row.role.padEnd(ROLE_PAD)} d${String(row.depth)} ${session_issue(row.issue).padEnd(ISSUE_PAD)}`
	const spent = `${cost_format.format_usd(row.cost_usd)} · ${format_minutes(row.elapsed_ms)} · ${String(row.request_count)} req · preamble ${cost_format.format_tokens(row.preamble_tokens)}`

	return `  ${tag} ${row.session_id}  ${spent}${session_parent(row.parent_id)}`
}

function session_lines(report: RunCostReport): Array<string> {
	return ['', 'Sessions (cost-heaviest first):', ...report.sessions.map((row) => session_line(row))]
}

// **`lead` is prepended, not built here.** The run-state block the no-argument `josh time` leads with
// is a caller's concern — `josh cost --run` passes none — so this report stays a cost report and only
// the lines it is handed sit above it (joshuafolkken/kit#1939).
function format_report(report: RunCostReport, lead: ReadonlyArray<string> = []): string {
	const body = [...header_lines(report), ...role_lines(report), ...session_lines(report)]

	return (lead.length === 0 ? body : [...lead, '', ...body]).join('\n')
}

function print_report(report: RunCostReport, is_json: boolean, lead: ReadonlyArray<string>): void {
	console.info(
		is_json ? JSON.stringify(report, undefined, JSON_INDENT) : format_report(report, lead),
	)
}

// The empty message is `cost_transcript`'s, so the `--run` scope names the same directories the
// session and issue scopes do when nothing was found.
function report_empty(cwd: string): number {
	const searched = cost_transcript.searched_directories(cost_transcript.transcript_directories(cwd))

	for (const line of cost_transcript.missing_message(searched, undefined)) console.error(line)

	return FAILURE_EXIT_CODE
}

// The `--run` scope end to end: load the tree the command ran in, roll it up by role, print it. An
// absent transcript store is reported in words, never priced at zero.
function run(
	cwd: string,
	run_id: string | undefined,
	is_json: boolean,
	lead: ReadonlyArray<string> = [],
): number {
	const tree = cost_run_tree.load(cwd, run_id)

	if (tree === undefined) return report_empty(cwd)

	print_report(build(tree.run_count, tree.unattributed_count, tree.nodes), is_json, lead)

	return OK_EXIT_CODE
}

const cost_run_report = { NOT_MEASURED, build, format_report, run }

export type { RunCostReport }
export { cost_run_report }
