import { describe, expect, it } from 'vitest'
import {
	ALIVE_VERDICT,
	PAUSED_VERDICT,
	PROCESS_ALIVE,
	PROCESS_NONE,
	run_liveness,
	SETTLED_VERDICT,
	STOPPED_VERDICT,
	type Traces,
} from './run-liveness'

// joshuafolkken/kit#4270. The lane state record answers a paused or ended lane before any trace is
// read, so a suspended child is never booked as stopped; a running or missing record leaves the
// verdict to the traces.

function arrange_traces(overrides: Partial<Traces> = {}): Traces {
	return {
		is_child_settled: false,
		is_output_frozen: true,
		is_tree_dirty: false,
		process_trace: PROCESS_NONE,
		...overrides,
	}
}

describe('the lane state record answers before the traces', () => {
	it('answers paused for a paused lane even with its process alive and its output frozen', () => {
		const traces = arrange_traces({ lane_state: 'paused', process_trace: PROCESS_ALIVE })
		const decision = run_liveness.decide(traces)

		expect(decision.verdict).toBe(PAUSED_VERDICT)
		expect(decision.advice).toContain('lane:resume')
	})

	it('answers settled for an ended lane', () => {
		expect(run_liveness.decide(arrange_traces({ lane_state: 'ended' })).verdict).toBe(
			SETTLED_VERDICT,
		)
	})

	it('leaves a running lane to the traces', () => {
		expect(run_liveness.decide(arrange_traces({ lane_state: 'running' })).verdict).toBe(
			STOPPED_VERDICT,
		)
	})

	it('leaves a lane with no record to the traces', () => {
		expect(run_liveness.decide(arrange_traces({ is_output_frozen: false })).verdict).toBe(
			ALIVE_VERDICT,
		)
	})
})
