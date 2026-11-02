import { lane_preserve } from '#scripts/lane/lane-preserve'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

// joshuafolkken/kit#5841: `run:merge --stash` keeps a stopped unit's lane work, but never a lane whose
// cut `resume_cut` may relaunch — that successor resumes from the uncommitted tree, and a clean one
// makes it refuse with the work stranded in the stash.

const relaunchable_mock = vi.hoisted(() => vi.fn<() => boolean>())

vi.mock(import('#scripts/run/cut/run-cut'), async (original) => {
	const actual = await original()

	return {
		...actual,
		run_cut: {
			...actual.run_cut,
			lane_cut_sync: vi.fn().mockReturnValue({ target: '/lane', cut: {} }),
			is_relaunchable: relaunchable_mock,
		},
	}
})

const { run_merge_steps } = await import('./run-merge-steps')

const CHILD = '5841'
const LANE: LaneInfo = {
	issue: CHILD,
	branch: `${CHILD}-lane`,
	directory: `/Users/runner/.kit-lanes/${CHILD}`,
	seat: undefined,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	dispatched_ms: undefined,
	is_stranded: false,
}

function arrange_cut(is_relaunchable: boolean): MockInstance<typeof lane_preserve.preserve_lane> {
	vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(LANE)
	relaunchable_mock.mockReturnValue(is_relaunchable)

	return vi.spyOn(lane_preserve, 'preserve_lane').mockResolvedValue(true)
}

describe('run_merge_steps.stash_stopped', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it('stashes the stopped unit under its own occasion', async () => {
		const preserve = arrange_cut(false)

		await run_merge_steps.stash_stopped(CHILD)

		expect(preserve).toHaveBeenCalledWith(CHILD, 'stopped unit', expect.any(String))
	})

	it('leaves a lane with a relaunchable cut for its successor', async () => {
		const preserve = arrange_cut(true)

		await run_merge_steps.stash_stopped(CHILD)

		expect(preserve).not.toHaveBeenCalled()
	})
})
