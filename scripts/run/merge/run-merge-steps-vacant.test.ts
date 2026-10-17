import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_carry } from '#scripts/run/carry/run-carry'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4028: #3988 parked itself and #4002 / #4005 ended before their start time, all
// three with no commit and no change, and their lanes stayed open and filled the limit of four while
// #4021, #4022 and #4026 waited. A child that ends without a merge now closes its lane when it is
// vacant, and keeps one that holds a commit or a change.

const is_vacant_mock = vi.hoisted(() => vi.fn())
const comment_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: {
		issue_add_label: vi.fn(async () => true),
		issue_try_comment: comment_mock,
	},
}))

vi.mock('#scripts/lane/lane-vacant', () => ({ lane_vacant: { is_vacant: is_vacant_mock } }))
vi.mock('#scripts/lane/lane-reap', () => ({ lane_reap: { reap_child: vi.fn() } }))
vi.mock('#scripts/run/run-label', () => ({ run_label: { unmark: vi.fn() } }))
vi.mock('./run-merge-ship', () => ({ run_merge_ship: { cause: vi.fn() } }))

const { run_merge_steps } = await import('./run-merge-steps')

const CHILD = '4002'
const BLOCKER = 4001
const LANE_CLOSE = 'lane:close'
const CONTEXT = {
	child: CHILD,
	epic: undefined,
	repo: undefined,
	over: CONTEXT_CUT_THRESHOLD,
	owner: run_carry.NO_OWNER,
}
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

const ENDINGS: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
	['failed', async () => await run_merge_steps.do_failed(CONTEXT)],
	['outage', async () => await run_merge_steps.do_outage(CONTEXT)],
	[
		'parked',
		async () => {
			await run_merge_steps.release_child(CHILD)
		},
	],
]

beforeEach(() => {
	is_vacant_mock.mockReset()
	comment_mock.mockReset().mockResolvedValue(undefined)
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: '' })
	vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(LANE)
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)
	vi.spyOn(git_gh_command, 'issue_blocked_by_references').mockResolvedValue([])
})

describe('run_merge_steps — a child that ended without a merge', () => {
	it.each(ENDINGS)('closes the vacant lane of a %s child', async (_ending, end) => {
		is_vacant_mock.mockResolvedValue(true)

		await end()

		expect(is_vacant_mock).toHaveBeenCalledWith(LANE)
		expect(josh_command.josh_run).toHaveBeenCalledWith([LANE_CLOSE, CHILD])
	})

	it.each(ENDINGS)(
		'keeps the lane of a %s child with a commit or a change',
		async (_ending, end) => {
			is_vacant_mock.mockResolvedValue(false)

			await end()

			expect(lane_close_calls()).toBe(0)
		},
	)

	it('closes the vacant lane of a child released to wait on an open blocker', async () => {
		is_vacant_mock.mockResolvedValue(true)
		vi.spyOn(git_gh_command, 'issue_blocked_by_references').mockResolvedValue([
			{ number: BLOCKER, repo: 'joshuafolkken/kit', state: 'OPEN' },
		])

		const result = await run_merge_steps.do_failed(CONTEXT)

		expect(result.blockers).toHaveLength(1)
		expect(josh_command.josh_run).toHaveBeenCalledWith([LANE_CLOSE, CHILD])
	})

	it('comments on no kept lane outside a split', async () => {
		is_vacant_mock.mockResolvedValue(false)

		await run_merge_steps.release_child(CHILD)

		expect(comment_mock).not.toHaveBeenCalled()
	})
})
