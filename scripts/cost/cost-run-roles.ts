import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import { cost_usage, type UsageRecord } from '#scripts/cost-runtime/cost-usage'
import { cost_dollar_composition, type DollarComposition } from './cost-dollar-composition'
import type { RunNode, RunRole } from './cost-run-nodes'

// Rolling a run tree's nodes up by role, in dollars (joshuafolkken/kit#1937).
//
// The question the hand measurement of 2026-09-13 answered and no command could — what share of a
// backlogrun the lanes, the subagents, the parent and the wakes each cost — is one `group by role`
// over the tree, priced with the same functions `josh cost` already uses per session. Nothing is
// re-priced here; the roles are just the axis the existing breakdown is summed along.

const NONE = 0
const WHOLE = 1
const TWO = 2

// The order the roles are reported in, cost-heaviest first, so the row that dominated the run leads.
const ROLE_ORDER: ReadonlyArray<RunRole> = ['parent', 'wake', 'lane', 'subagent']

interface RoleTotals {
	role: RunRole
	session_count: number
	request_count: number
	output_tokens: number
	cost_usd: number
	composition: DollarComposition
	// The resident preamble every session in this role opened with, summed — what the role paid before
	// any of its own work, which for the wakes is the resume cost the run keeps re-establishing.
	preamble_tokens: number
	// This role's share of the run's priced total, in `[0, 1]`. The four shares sum to one because
	// every node falls in exactly one role; an unreadable session contributes nothing to either side.
	cost_share: number
	// The active wall time this role's sessions spent, summed across them, and its share of the run's
	// summed active time. Summed rather than merged into one span because lane children run at once:
	// the question is how much work each role did, and the run's own wall clock is the parent's window
	// (joshuafolkken/kit#1937). `josh time --run` leads with this axis, `josh cost --run` with dollars.
	elapsed_ms: number
	elapsed_share: number
}

interface SessionRow {
	session_id: string
	role: RunRole
	issue: number | undefined
	parent_id: string | undefined
	depth: number
	cost_usd: number
	elapsed_ms: number
	request_count: number
	preamble_tokens: number
}

interface RunRoles {
	roles: ReadonlyArray<RoleTotals>
	// One row per session, cost-heaviest first, each carrying its role, issue, parent link and depth.
	sessions: ReadonlyArray<SessionRow>
	total_usd: number
	total_elapsed_ms: number
	// Sessions whose transcript could not be measured — reported as a count, never as a zero folded
	// into the shares above (joshuafolkken/kit#1937).
	unreadable_count: number
}

// A role's totals against the run's, held together so `role_totals` stays within the parameter limit.
interface RunDenominators {
	total_usd: number
	total_elapsed_ms: number
}

function records_of(nodes: ReadonlyArray<RunNode>): Array<UsageRecord> {
	return nodes.flatMap((node) => [...node.records])
}

function cost_of(records: ReadonlyArray<UsageRecord>): number {
	return cost_pricing.cost_of(records)
}

// A session's active span: the last request instant less the first. Zero when fewer than two
// requests carried a readable timestamp, the honest reading of a span that cannot be measured.
function elapsed_of(records: ReadonlyArray<UsageRecord>): number {
	const stamps = records
		.map((record) => record.at_ms)
		.filter((ms): ms is number => ms !== undefined)

	return stamps.length < TWO ? NONE : Math.max(...stamps) - Math.min(...stamps)
}

function elapsed_of_nodes(nodes: ReadonlyArray<RunNode>): number {
	return nodes.reduce((total, node) => total + elapsed_of(node.records), NONE)
}

function preamble_of(nodes: ReadonlyArray<RunNode>): number {
	return nodes.reduce((total, node) => total + node.baseline_tokens, NONE)
}

function share(part: number, whole: number): number {
	return whole === NONE ? NONE : part / whole
}

function role_totals(
	role: RunRole,
	nodes: ReadonlyArray<RunNode>,
	run: RunDenominators,
): RoleTotals {
	const records = records_of(nodes)
	const models = cost_pricing.cost_by_model(records)
	const cost_usd = cost_pricing.total_cost(models).usd
	const elapsed_ms = elapsed_of_nodes(nodes)

	return {
		role,
		session_count: nodes.length,
		request_count: records.length,
		output_tokens: cost_usage.sum_totals(records).output_tokens,
		cost_usd,
		composition: cost_dollar_composition.build(models),
		preamble_tokens: preamble_of(nodes),
		cost_share: share(cost_usd, run.total_usd),
		elapsed_ms,
		elapsed_share: share(elapsed_ms, run.total_elapsed_ms),
	}
}

function nodes_in_role(nodes: ReadonlyArray<RunNode>, role: RunRole): Array<RunNode> {
	return nodes.filter((node) => node.role === role)
}

function build_roles(nodes: ReadonlyArray<RunNode>, run: RunDenominators): Array<RoleTotals> {
	return ROLE_ORDER.map((role) => role_totals(role, nodes_in_role(nodes, role), run)).filter(
		(totals) => totals.session_count > NONE,
	)
}

function to_row(node: RunNode): SessionRow {
	return {
		session_id: node.session_id,
		role: node.role,
		issue: node.issue,
		parent_id: node.parent_id,
		depth: node.depth,
		cost_usd: cost_of(node.records),
		elapsed_ms: elapsed_of(node.records),
		request_count: node.records.length,
		preamble_tokens: node.baseline_tokens,
	}
}

function build_rows(nodes: ReadonlyArray<RunNode>): Array<SessionRow> {
	return nodes.map((node) => to_row(node)).toSorted((left, right) => right.cost_usd - left.cost_usd)
}

function unreadable_of(nodes: ReadonlyArray<RunNode>): number {
	return nodes.filter((node) => !node.is_readable).length
}

// The whole tree summed by role. The two denominators are computed once and handed to every role so
// each share is taken against the same total, which is what makes the shares sum to one.
function build(nodes: ReadonlyArray<RunNode>): RunRoles {
	const run = { total_usd: cost_of(records_of(nodes)), total_elapsed_ms: elapsed_of_nodes(nodes) }

	return {
		roles: build_roles(nodes, run),
		sessions: build_rows(nodes),
		total_usd: run.total_usd,
		total_elapsed_ms: run.total_elapsed_ms,
		unreadable_count: unreadable_of(nodes),
	}
}

// Whether the reported shares account for the whole, to a rounding tolerance — a test's assertion and
// a guard against a role slipping out of `ROLE_ORDER`.
function shares_total(roles: ReadonlyArray<RoleTotals>): number {
	return roles.reduce((total, role) => total + role.cost_share, NONE)
}

const cost_run_roles = { ROLE_ORDER, WHOLE, build, shares_total }

export type { RoleTotals, RunRoles, SessionRow }
export { cost_run_roles }
