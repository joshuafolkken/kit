import { figure_format } from '#scripts/lib/figure-format'
import type { RunNode } from './cost-run-nodes'
import { cost_run_roles } from './cost-run-roles'

// The lane children's spend split by the phase each session worked in — implementation, or the ship
// region a pre-gate resume drives (gate, commit, PR, merge). It is the reading a per-phase worker
// model (`JOSH_WORKER_SHIP_MODEL`, joshuafolkken/kit#5343) is judged by: how many requests, and how
// many dollars, the ship phase costs against the implementation phase.
//
// **A session is one phase, whole.** A lane child that ships without a cut is counted as
// implementation; only a session relaunched into the gate (`RunNode.is_ship`) is the ship phase.

type WorkerPhase = 'implement' | 'ship'

const NONE = 0
const PHASE_PAD = 9

interface PhaseTotals {
	phase: WorkerPhase
	session_count: number
	request_count: number
	cost_usd: number
}

function totals_of(phase: WorkerPhase, nodes: ReadonlyArray<RunNode>): PhaseTotals {
	const lane = cost_run_roles.build(nodes).roles.find((totals) => totals.role === 'lane')

	if (lane === undefined) return { phase, session_count: NONE, request_count: NONE, cost_usd: NONE }

	return {
		phase,
		session_count: lane.session_count,
		request_count: lane.request_count,
		cost_usd: lane.cost_usd,
	}
}

function build(nodes: ReadonlyArray<RunNode>): ReadonlyArray<PhaseTotals> {
	const lanes = nodes.filter((node) => node.role === 'lane')

	return [
		totals_of(
			'implement',
			lanes.filter((node) => !node.is_ship),
		),
		totals_of(
			'ship',
			lanes.filter((node) => node.is_ship),
		),
	]
}

function phase_line(totals: PhaseTotals): string {
	const requests = `${String(totals.request_count)} request(s)`

	return `  ${totals.phase.padEnd(PHASE_PAD)} ${String(totals.session_count)} session(s) · ${requests} · ${figure_format.format_usd(totals.cost_usd)}`
}

// Printed only when the run has a lane child, so a run without one carries no empty block.
function format_lines(phases: ReadonlyArray<PhaseTotals>): Array<string> {
	if (phases.every((totals) => totals.session_count === NONE)) return []

	return ['', 'Worker by phase:', ...phases.map((totals) => phase_line(totals))]
}

const cost_run_phase = { build, format_lines }

export type { PhaseTotals, WorkerPhase }
export { cost_run_phase }
