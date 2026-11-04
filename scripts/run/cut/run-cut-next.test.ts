import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_cut_next } from './run-cut-next'

const error = vi.spyOn(console, 'error').mockReturnValue()
const GATE = 'pnpm josh run:chain 6235'

beforeEach(() => {
	error.mockClear()
})
afterAll(() => {
	error.mockRestore()
})

describe('the pre-gate cut next action', () => {
	it.each([
		['cut', 'End the turn immediately.'],
		['under-threshold', GATE],
		['not-a-lane', GATE],
		['unready', GATE],
		['busy', 'Do not relaunch; a cut is already in flight.'],
		['failed', GATE],
		['unknown', GATE],
		[
			'split-unresolved',
			'Follow split-assessment.md → "Over the guide before the gate", then reissue the cut.',
		],
		[
			'budget-over',
			'pnpm josh issue:spill 6235 --estimate "<files> ファイル / <lines> 行", then pnpm josh run:chain 6235',
		],
	])('prints one next line for %s', (verdict, action) => {
		run_cut_next.print_next(verdict, '6235')

		expect(error).toHaveBeenCalledExactlyOnceWith(`next: ${action}`)
	})

	it('leaves other verdicts to their own protocol', () => {
		run_cut_next.print_next('resume', '6235')

		expect(error).not.toHaveBeenCalled()
	})
})
