import { time_contributor_costs, type ContributorCostFacts } from './time-contributor-costs'
import { time_delegated_cost, type DelegatedCostFacts } from './time-delegated-cost'
import { time_phase_costs, type PhaseCostFacts } from './time-phase-costs'

// The three dollar blocks, in the order they print, gathered into one function so `time-report.ts`'s
// `format_report` keeps one line per block as each of them was added (joshuafolkken/kit#1606,
// joshuafolkken/kit#1872, joshuafolkken/kit#1882). It is the same seam `turn_blocks` is — a block
// grouping moved to its own file for the length limit `time-report.ts` keeps reaching. The param is
// the three optional fields rather than the whole `TimeReport`, so nothing here depends back on it.
interface CostBlocks {
	phase_costs?: PhaseCostFacts
	contributor_costs?: ContributorCostFacts
	delegated_cost?: DelegatedCostFacts
}

function cost_block_lines(report: CostBlocks): Array<string> {
	return [
		...time_phase_costs.cost_lines(report.phase_costs),
		...time_contributor_costs.cost_lines(report.contributor_costs),
		...time_delegated_cost.cost_lines(report.delegated_cost),
	]
}

const time_cost_blocks = { cost_block_lines }

export type { CostBlocks }
export { time_cost_blocks }
