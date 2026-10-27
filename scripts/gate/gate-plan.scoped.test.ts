import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { describe, expect, it } from 'vitest'
import { gate_plan } from './gate-plan'

const { MEASURED_CORES } = gate_plan
const { MAIN_PROCESS_CORES, MIN_WORKERS } = unit_worker_share
// The two related scopes joshuafolkken/kit#5135 measured: a typical narrowed run and the whole suite.
const NARROW_FILES = 69
const SUITE_FILES = 2080

function weight_of(files: number): number {
	return gate_plan.scoped_unit_weight(files, MEASURED_CORES, 0)
}

// joshuafolkken/kit#5135: a 69-file `josh test:related` claimed the same width as the whole suite, so
// every other lane's unit claim waited behind a twenty-second run for the full width to free.
describe('gate_plan.scoped_unit_weight — the cores a narrowed related run reserves', () => {
	it('claims less for a 69-file scope than for a 2080-file one', () => {
		expect(weight_of(NARROW_FILES)).toBeLessThan(weight_of(SUITE_FILES))
	})

	it('claims at least the minimum workers and vitest itself', () => {
		expect(weight_of(NARROW_FILES)).toBe(MIN_WORKERS + MAIN_PROCESS_CORES)
	})

	it('never claims more than a direct unit run does', () => {
		expect(weight_of(SUITE_FILES)).toBe(gate_plan.direct_unit_weight(MEASURED_CORES, 0))
	})

	it('opens one worker for each FILES_PER_WORKER files between the bounds', () => {
		const workers = MIN_WORKERS + 1

		expect(weight_of(gate_plan.FILES_PER_WORKER * workers)).toBe(workers + MAIN_PROCESS_CORES)
	})
})
