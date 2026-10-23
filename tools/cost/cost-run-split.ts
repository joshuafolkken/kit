import { figure_format } from '#scripts/lib/figure-format'
import { cost_run_nodes, type RunNode, type RunRole } from './cost-run-nodes'
import { cost_run_roles, type RoleTotals } from './cost-run-roles'

// The run tree split at one instant and rolled up by role on each side — the before/after reading a
// change to how the run spends its time is judged by (#4000: did removing the wakes' polling, #3925,
// shrink the wake role's share?).
//
// A session lands on the side its first request falls on, never on both: a session is one unit of
// spend, and cutting one in half would price a resume against the wrong side. A session with no
// stamped request has no side and is left out, the same way the roles leave an unreadable one
// unpriced rather than counted as a zero.

const NONE = 0
const DENSITY_DIGITS = 1
const ROLE_PAD = 8
const NO_VALUE = '—'

interface SplitSide {
	session_count: number
	total_usd: number
	total_elapsed_ms: number
	roles: ReadonlyArray<RoleTotals>
}

interface RunSplit {
	at: string
	before: SplitSide
	after: SplitSide
}

function to_side(nodes: ReadonlyArray<RunNode>): SplitSide {
	const roles = cost_run_roles.build(nodes)

	return {
		session_count: nodes.length,
		total_usd: roles.total_usd,
		total_elapsed_ms: roles.total_elapsed_ms,
		roles: roles.roles,
	}
}

function build(nodes: ReadonlyArray<RunNode>, at_ms: number): RunSplit {
	const starts = nodes.map((node) => ({ node, start: cost_run_nodes.started_ms(node.records) }))
	const stamped = starts.filter((entry) => Number.isFinite(entry.start))

	return {
		at: new Date(at_ms).toISOString(),
		before: to_side(stamped.filter((entry) => entry.start < at_ms).map((entry) => entry.node)),
		after: to_side(stamped.filter((entry) => entry.start >= at_ms).map((entry) => entry.node)),
	}
}

function side_line(label: string, side: SplitSide): string {
	const minutes = figure_format.format_minutes(side.total_elapsed_ms)

	return `  ${label.padEnd(ROLE_PAD)} ${String(side.session_count)} session(s) · ${minutes} · ${figure_format.format_usd(side.total_usd)}`
}

function role_of(side: SplitSide, role: RunRole): RoleTotals | undefined {
	return side.roles.find((totals) => totals.role === role)
}

function time_share(totals: RoleTotals | undefined, side: SplitSide): string {
	if (totals === undefined) return NO_VALUE

	return figure_format.format_share(totals.elapsed_ms, side.total_elapsed_ms)
}

function cost_share(totals: RoleTotals | undefined, side: SplitSide): string {
	if (totals === undefined) return NO_VALUE

	return figure_format.format_share(totals.cost_usd, side.total_usd)
}

// Requests per session — the density the polling inflated: a wake that polls spends its requests
// waiting, so the same work done without the poll shows as fewer requests per wake session.
function density(totals: RoleTotals | undefined): string {
	if (totals === undefined || totals.session_count === NONE) return NO_VALUE

	return (totals.request_count / totals.session_count).toFixed(DENSITY_DIGITS)
}

function role_line(split: RunSplit, role: RunRole): string {
	const before = role_of(split.before, role)
	const after = role_of(split.after, role)
	const time = `time ${time_share(before, split.before)} → ${time_share(after, split.after)}`
	const spent = `cost ${cost_share(before, split.before)} → ${cost_share(after, split.after)}`

	return `  ${role.padEnd(ROLE_PAD)} ${time} · ${spent} · req/session ${density(before)} → ${density(after)}`
}

function has_role(split: RunSplit, role: RunRole): boolean {
	return role_of(split.before, role) !== undefined || role_of(split.after, role) !== undefined
}

function format_lines(split: RunSplit): Array<string> {
	const roles = cost_run_roles.ROLE_ORDER.filter((role) => has_role(split, role))

	return [
		'',
		`Before → after ${split.at} (each session by its first request):`,
		side_line('before', split.before),
		side_line('after', split.after),
		...roles.map((role) => role_line(split, role)),
	]
}

const cost_run_split = { build, format_lines }

export type { RunSplit, SplitSide }
export { cost_run_split }
