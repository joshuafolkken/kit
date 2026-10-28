import { josh_command } from '#scripts/josh/josh-run'
import { describe, expect, it, vi } from 'vitest'
import { run_merge_steps } from './run-merge-steps'

describe('run_merge_steps.is_over_budget — a loop no session owns', () => {
	it('answers under without measuring when no check is asked', async () => {
		const subprocess = vi.spyOn(josh_command, 'josh_run')

		expect(await run_merge_steps.is_over_budget(undefined)).toBe(false)
		expect(subprocess).not.toHaveBeenCalled()
		subprocess.mockRestore()
	})
})

// joshuafolkken/kit#5341: the merge asks `--cut` so the threshold is priced at the session's model,
// never a fixed `--over` number.
describe('run_merge_steps.is_over_budget — an owned loop', () => {
	it.each([
		['under', false],
		['over', true],
	])('asks the cut verdict and reads %s as %s', async (verdict, expected) => {
		const subprocess = vi
			.spyOn(josh_command, 'josh_run')
			.mockResolvedValue({ code: 0, out: verdict })

		expect(await run_merge_steps.is_over_budget(true)).toBe(expected)
		expect(subprocess).toHaveBeenCalledWith(['cost', '--cut'])
		subprocess.mockRestore()
	})

	it('reads a measurement that fails as over', async () => {
		const subprocess = vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 1, out: '' })

		expect(await run_merge_steps.is_over_budget(true)).toBe(true)
		subprocess.mockRestore()
	})
})
