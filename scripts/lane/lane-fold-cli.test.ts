import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_fold } from './lane-fold'
import { lane_fold_cli } from './lane-fold-cli'

const fold = vi.spyOn(lane_fold, 'fold')
const error = vi.spyOn(console, 'error')

const FOLDED = {
	kind: 'folded',
	is_withdrawn: true,
	stash: undefined,
	is_noted: true,
	blocked: 'recorded',
} as const

describe('lane_fold_cli.run', () => {
	beforeEach(() => {
		fold.mockReset()
		fold.mockResolvedValue(FOLDED)
		error.mockImplementation(vi.fn())
	})

	it.each([
		['--into missing', ['7945', '--reason', 'r']],
		['--reason missing', ['7945', '--into', '7951']],
		['an empty reason', ['7945', '--into', '7951', '--reason', ' ']],
		['a malformed --into', ['7945', '--into', 'x', '--reason', 'r']],
		['no issue', ['--into', '7951', '--reason', 'r']],
		['two issues', ['7945', '7946', '--into', '7951', '--reason', 'r']],
		['an issue folded into itself', ['7945', '--into', '7945', '--reason', 'r']],
	])('refuses %s without folding', async (_name, argv) => {
		expect(await lane_fold_cli.run(argv)).toBe(1)
		expect(fold).not.toHaveBeenCalled()
	})

	it.each([['7951'], ['#7951']])('accepts --into %s', async (into) => {
		expect(await lane_fold_cli.run(['#7945', '--into', into, '--reason', 'r'])).toBe(0)
		expect(fold).toHaveBeenCalledWith({ issue: '7945', into: '7951', reason: 'r' })
		expect(error).toHaveBeenCalledWith(
			expect.stringMatching(/\nblock .*7945.* on .*7951.*: recorded/u),
		)
	})

	it('exits 1 naming the failed step and the re-run', async () => {
		fold.mockResolvedValue({ kind: 'failed', step: 'note', message: 'boom' })

		expect(await lane_fold_cli.run(['7945', '--into', '7951', '--reason', 'r'])).toBe(1)
		expect(error).toHaveBeenCalledWith(expect.stringContaining('stopped at note: boom'))
		expect(error).toHaveBeenCalledWith(expect.stringContaining('Re-run'))
	})
})
