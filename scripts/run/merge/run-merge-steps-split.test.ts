import { josh_command } from '#scripts/josh/josh-run'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#3334: a child promoted to an epic by a split leaves its lane open, and the epic root
// is never dispatched again — so the driver closes that lane when it holds nothing, and keeps it, with
// the reason on the issue, when it holds a commit, a change or a live process.

const comment_mock = vi.hoisted(() => vi.fn())
const is_vacant_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_try_comment: comment_mock },
}))

vi.mock('#scripts/lane/lane-vacant', () => ({ lane_vacant: { is_vacant: is_vacant_mock } }))

const { run_merge_steps } = await import('./run-merge-steps')

const CHILD = '3255'
const LANE_CLOSE = 'lane:close'
const LANE: LaneInfo = {
	issue: CHILD,
	branch: `${CHILD}-lane`,
	directory: `/lanes/${CHILD}`,
	seat: 1,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
}

function lane_close_calls(): number {
	const { calls } = vi.mocked(josh_command.josh_run).mock

	return calls.filter(([args]) => args[0] === LANE_CLOSE).length
}

beforeEach(() => {
	comment_mock.mockReset().mockResolvedValue(undefined)
	is_vacant_mock.mockReset()
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: '' })
	vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(LANE)
})

describe('run_merge_steps.close_split_lane — the split child’s lane', () => {
	it('closes a vacant lane so the epic does not hold a seat', async () => {
		is_vacant_mock.mockResolvedValue(true)

		await run_merge_steps.close_split_lane(CHILD)

		expect(is_vacant_mock).toHaveBeenCalledWith(LANE)
		expect(josh_command.josh_run).toHaveBeenCalledWith([LANE_CLOSE, CHILD])
		expect(comment_mock).not.toHaveBeenCalled()
	})

	it('keeps a lane with a commit, a change or a live process and states why on the issue', async () => {
		is_vacant_mock.mockResolvedValue(false)

		await run_merge_steps.close_split_lane(CHILD)

		expect(lane_close_calls()).toBe(0)
		expect(comment_mock).toHaveBeenCalledWith(CHILD, expect.stringContaining(LANE.directory))
	})

	it('does nothing when the child has no open lane', async () => {
		vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(undefined)

		await run_merge_steps.close_split_lane(CHILD)

		expect(is_vacant_mock).not.toHaveBeenCalled()
		expect(lane_close_calls()).toBe(0)
		expect(comment_mock).not.toHaveBeenCalled()
	})
})
