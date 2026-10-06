import { stamp_file } from '#scripts/josh/stamp-file'
import { expect, it, vi } from 'vitest'
import type { RunCarry } from './run-carry'
import { run_carry_args } from './run-carry-args'
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

// joshuafolkken/kit#3296: a hand count and the driver's `run:merge` for one issue each arrive as a
// merge naming that issue, so the second is a duplicate whichever came first.
it('counts one issue merged by hand and by run:merge once', () => {
	const write = vi.spyOn(stamp_file, 'write_stamp').mockImplementation(vi.fn())
	const hand = run_carry_args.read_arguments(['--merged', '3289'])
	const request = hand === undefined ? undefined : run_carry_args.to_request(hand)

	if (request?.kind !== 'count') throw new Error('expected a count request')

	const first = run_carry_change.apply_change('carry', CARRY, request.change)
	const second = run_carry_change.apply_change('carry', first, { merged: 1, merged_issue: 3289 })

	expect(second.merged).toBe(1)
	expect(second.merged_issues).toStrictEqual([3289])
	write.mockRestore()
})

it('keeps a filing and a done issue counted beside a duplicate merge', () => {
	const write = vi.spyOn(stamp_file, 'write_stamp').mockImplementation(vi.fn())
	const first = run_carry_change.apply_change('carry', CARRY, { merged: 1, merged_issue: 3289 })
	const second = run_carry_change.apply_change('carry', first, {
		merged: 1,
		merged_issue: 3289,
		filed: 1,
		done: 3289,
	})

	expect(second).toMatchObject({ merged: 1, merged_issues: [3289], filed: 1, done: [3289] })
	write.mockRestore()
})
