import { stamp_file } from '#scripts/josh/stamp-file'
import { expect, it, vi } from 'vitest'
import type { RunCarry } from './run-carry'
import { run_carry_change } from './run-carry-change'

const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: '2026-09-24T00:00:00.000Z',
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}

it('counts a merged issue once across a restart before the merge event', () => {
	const write = vi.spyOn(stamp_file, 'write_stamp').mockImplementation(vi.fn())
	const first = run_carry_change.apply_change('carry', CARRY, { merged: 1, merged_issue: 2508 })
	const restarted = structuredClone(first)
	const repeated = run_carry_change.apply_change('carry', restarted, {
		merged: 1,
		merged_issue: 2508,
	})

	expect(repeated.merged).toBe(1)
	expect(repeated.merged_issues).toStrictEqual([2508])
	expect(write).toHaveBeenCalledTimes(1)
	write.mockRestore()
})
