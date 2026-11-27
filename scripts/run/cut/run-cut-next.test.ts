import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_cut_next } from './run-cut-next'

const error = vi.spyOn(console, 'error').mockReturnValue()
const GATE = 'pnpm josh run:chain 6235'
const DELIVERABLE = 'https://example.test/c'

beforeEach(() => {
	error.mockClear()
})
afterAll(() => {
	error.mockRestore()
})

describe('the pre-gate cut next action', () => {
	it.each([
		['cut', 'End the turn immediately.'],
		['concluded', "End the turn; the parent's run:merge returns the lane."],
		['under-threshold', GATE],
		['not-a-lane', GATE],
		['unready', GATE],
		['busy', 'Do not relaunch; a cut is already in flight.'],
		['failed', GATE],
		['unknown', GATE],
	])('prints one next line for %s', (verdict, action) => {
		run_cut_next.print_next(verdict, '6235')

		expect(error).toHaveBeenCalledExactlyOnceWith(`next: ${action}`)
	})

	it('points an unmet --deliverable close at a rerun, not the gate', () => {
		run_cut_next.print_next('unready', '6235', DELIVERABLE)

		expect(error).toHaveBeenCalledExactlyOnceWith(
			'next: meet the condition printed above, then rerun `pnpm josh run:cut 6235 --deliverable https://example.test/c`.',
		)
	})

	it('keeps the gate for a deliverable that was not refused as unready', () => {
		run_cut_next.print_next('failed', '6235', DELIVERABLE)

		expect(error).toHaveBeenCalledExactlyOnceWith(`next: ${GATE}`)
	})

	// joshuafolkken/kit#7010: `budget-over` is no verdict of the pre-gate cut any more, so it prints no spill.
	it.each(['resume', 'budget-over'])('leaves %s to its own protocol', (verdict) => {
		run_cut_next.print_next(verdict, '6235')

		expect(error).not.toHaveBeenCalled()
	})
})
