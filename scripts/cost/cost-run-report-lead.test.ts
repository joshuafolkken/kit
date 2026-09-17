import { describe, expect, it } from 'vitest'
import { cost_run_report, type RunCostReport } from './cost-run-report'

// The no-argument `josh time` hands the run-tree report a lead block so an unfinished run is shown at
// the front (joshuafolkken/kit#1939). `josh cost --run` hands none, which must leave the report as it
// was.
const STATE_HEADING = 'Run state (from run:carry / run:wake):'
const TREE_HEADER = 'run tree —'

const REPORT: RunCostReport = {
	scope: 'run tree',
	session_count: 1,
	run_count: 1,
	merged: undefined,
	unattributed_count: 0,
	unreadable_count: 0,
	total_usd: 0,
	total_elapsed_ms: 0,
	roles: [],
	sessions: [],
}

describe('cost_run_report.format_report lead', () => {
	it('prepends the lead above the run-tree header', () => {
		const text = cost_run_report.format_report(REPORT, [
			STATE_HEADING,
			'  status: cut, but no successor took over',
		])

		expect(text.startsWith(STATE_HEADING)).toBe(true)
		expect(text.indexOf(STATE_HEADING)).toBeLessThan(text.indexOf(TREE_HEADER))
	})

	it('prints the run-tree report alone when handed no lead', () => {
		expect(cost_run_report.format_report(REPORT).startsWith(TREE_HEADER)).toBe(true)
	})
})
