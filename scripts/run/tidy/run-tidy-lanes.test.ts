import { git_spawn } from '#scripts/git/git-spawn'
import { git_stash } from '#scripts/git/stash/git-stash'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_close } from '#scripts/lane/lane-close'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_hold } from '#scripts/run/hold/run-hold'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_tidy_lanes } from './run-tidy-lanes'

vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: vi.fn() } }))
vi.mock('#scripts/git/stash/git-stash', () => ({ git_stash: { has_changes: vi.fn() } }))
vi.mock('#scripts/lane/lane-close', () => ({ lane_close: { close_lane: vi.fn() } }))
vi.mock('#scripts/lane/lane-registry', () => ({ lane_registry: { list_lanes: vi.fn() } }))
vi.mock('#scripts/run/hold/run-hold', () => ({
	run_hold: { hold_path: vi.fn(), read_hold: vi.fn(), release_hold: vi.fn() },
}))

const MERGED_ISSUE = '2583'
const OPEN_ISSUE = '2701'
const HOLD_PATH = '/state/josh-run-hold-lane'
const MERGED_DIRECTORY = '/lanes/2583'
const GIT_DIRECTORY = '/repo/.git/worktrees/2583'

function lane(issue: string, is_stranded = false): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded,
	}
}

// `rev-parse --absolute-git-dir` answers the lane's git directory; `rev-list --count` its unpushed count.
function git_answers(unpushed: string): void {
	vi.mocked(git_spawn.read).mockImplementation(async (args) =>
		args.includes('rev-list') ? unpushed : GIT_DIRECTORY,
	)
}

async function is_merged(issue: string): Promise<boolean> {
	return issue === MERGED_ISSUE
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(lane_registry.list_lanes).mockResolvedValue([lane(MERGED_ISSUE), lane(OPEN_ISSUE)])
	vi.mocked(git_stash.has_changes).mockResolvedValue(false)
	vi.mocked(run_hold.hold_path).mockReturnValue(HOLD_PATH)
	vi.mocked(run_hold.read_hold).mockReturnValue({ kind: 'free' })
	vi.mocked(lane_close.close_lane).mockResolvedValue({
		issue: MERGED_ISSUE,
		kind: 'closed',
		left_behind: [],
		reaped: [],
	})
	git_answers('0')
})

// joshuafolkken/kit#2701: a merged lane held a seat until a person closed it.
describe('run_tidy_lanes.tidy_lanes', () => {
	it('closes the merged lane, releases its run record, and leaves the open one alone', async () => {
		const outcomes = await run_tidy_lanes.tidy_lanes(is_merged)

		expect(outcomes).toStrictEqual([
			{ target: `lane ${session_cite.issue(2583)}`, verdict: { kind: 'clean' } },
		])
		expect(lane_close.close_lane).toHaveBeenCalledExactlyOnceWith(MERGED_ISSUE)
		expect(run_hold.hold_path).toHaveBeenCalledWith(GIT_DIRECTORY)
		expect(run_hold.release_hold).toHaveBeenCalledWith(HOLD_PATH)
	})

	// joshuafolkken/kit#3451: closed here, an in-flight lane left the run with no `merge` event.
	it('leaves a merged lane the running backlogrun still has in flight to its run:merge', async () => {
		const outcomes = await run_tidy_lanes.tidy_lanes(is_merged, new Set([MERGED_ISSUE]))

		expect(outcomes).toStrictEqual([])
		expect(lane_close.close_lane).not.toHaveBeenCalled()
	})

	it('keeps a merged lane with uncommitted changes', async () => {
		vi.mocked(git_stash.has_changes).mockResolvedValue(true)

		const outcomes = await run_tidy_lanes.tidy_lanes(is_merged)

		expect(outcomes[0]?.verdict).toStrictEqual({ kind: 'keep', reason: 'uncommitted changes' })
		expect(lane_close.close_lane).not.toHaveBeenCalled()
	})

	it('keeps a merged lane with commits no remote has', async () => {
		git_answers('2')

		await run_tidy_lanes.tidy_lanes(is_merged)

		expect(lane_close.close_lane).not.toHaveBeenCalled()
	})

	it('keeps a merged lane a live run still holds', async () => {
		vi.mocked(run_hold.read_hold).mockReturnValue({
			kind: 'held',
			hold: { issue: MERGED_ISSUE, taken_at: '2026-09-29T00:00:00.000Z', pid: 1 },
		})

		await run_tidy_lanes.tidy_lanes(is_merged)

		expect(lane_close.close_lane).not.toHaveBeenCalled()
	})
})

describe('run_tidy_lanes.tidy_lanes — lanes it leaves to others', () => {
	it('leaves a stranded lane to lane:prune', async () => {
		vi.mocked(lane_registry.list_lanes).mockResolvedValue([lane(MERGED_ISSUE, true)])

		expect(await run_tidy_lanes.tidy_lanes(is_merged)).toStrictEqual([])
	})

	it('keeps the record when the close left files behind', async () => {
		vi.mocked(lane_close.close_lane).mockResolvedValue({
			issue: MERGED_ISSUE,
			kind: 'incomplete',
			left_behind: [MERGED_DIRECTORY],
			reaped: [],
		})

		const outcomes = await run_tidy_lanes.tidy_lanes(is_merged)

		expect(outcomes[0]?.verdict.kind).toBe('keep')
		expect(run_hold.release_hold).not.toHaveBeenCalled()
	})

	it('treats an unreadable unpushed count as unpushed', async () => {
		vi.mocked(git_spawn.read).mockRejectedValue(new Error('no HEAD'))

		expect(await run_tidy_lanes.has_unpushed(MERGED_DIRECTORY)).toBe(true)
	})
})
