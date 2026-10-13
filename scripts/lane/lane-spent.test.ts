import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaneInfo } from './lane-registry'
import type { SpentProbes } from './lane-spent'

const live = vi.hoisted(() => ({
	commit_count_unpushed: vi.fn(),
	current_events: vi.fn(),
	is_tree_dirty: vi.fn(),
	issue_view_json: vi.fn(),
	process_trace_default: vi.fn(),
}))

vi.mock('./lane-registry', () => ({ lane_registry: { list_lanes: vi.fn() } }))
vi.mock('#scripts/git/git-command', () => ({
	git_command: { commit_count_unpushed: live.commit_count_unpushed },
}))
vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_view_json: live.issue_view_json },
}))
vi.mock('#scripts/run/hold/run-hold', () => ({ run_hold: { is_tree_dirty: live.is_tree_dirty } }))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { current_events: live.current_events },
}))
vi.mock('./lane-await', () => ({
	lane_await: { process_trace_default: live.process_trace_default },
}))

const { lane_registry } = await import('./lane-registry')
const { lane_spent } = await import('./lane-spent')

// joshuafolkken/kit#3733: a lane a past run left behind is discarded and stops nothing, while a lane
// holding anything a close cannot give back is kept with the reason said.

const LANE: LaneInfo = {
	issue: '3347',
	branch: '3347-lane',
	directory: '/lanes/3347',
	seat: 1,
	development_port: 5173,
	preview_port: 4173,
	output: undefined,
	is_stranded: false,
}
const OTHER: LaneInfo = { ...LANE, issue: '3701', branch: '3701-lane', directory: '/lanes/3701' }
const UNPUSHED = 2
const LAUNCHED_AT = '2026-10-13T09:00:00.000Z'
const CHILD_REASON = 'a child is still working in it'
const OPEN_REASON = 'its issue is still open'
const UNREAD_ISSUE_REASON = 'its issue could not be read'
const UNCOUNTED_REASON = 'its commits could not be counted'
const IN_FLIGHT_REASON =
	'the running backlogrun has not collected it yet (`pnpm josh run:merge` does)'

function probes_of(overrides: Partial<SpentProbes> = {}): SpentProbes {
	return {
		process_trace: () => 'none',
		issue_state: async () => 'CLOSED',
		in_flight: async () => new Set<string>(),
		is_tree_dirty: async () => false,
		unpushed_commits: async () => 0,
		...overrides,
	}
}

async function reason_with(overrides: Partial<SpentProbes>): Promise<string | undefined> {
	return await lane_spent.kept_reason(LANE, probes_of(overrides))
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(lane_registry.list_lanes).mockResolvedValue([LANE, OTHER])
	live.process_trace_default.mockReturnValue('none')
	live.issue_view_json.mockResolvedValue('{"state":"CLOSED"}')
	live.is_tree_dirty.mockResolvedValue(false)
	live.commit_count_unpushed.mockResolvedValue(0)
	live.current_events.mockResolvedValue([])
})

describe('lane_spent.kept_reason', () => {
	it('answers spent for a closed issue, no child, a clean tree and nothing unpushed', async () => {
		const probes = probes_of({ unpushed_commits: vi.fn(async () => 0) })

		await expect(lane_spent.kept_reason(LANE, probes)).resolves.toBeUndefined()
		expect(probes.unpushed_commits).toHaveBeenCalledExactlyOnceWith(LANE.branch)
	})

	it('keeps a lane a child is working in', async () => {
		await expect(reason_with({ process_trace: () => 'alive' })).resolves.toBe(CHILD_REASON)
	})

	it('keeps a lane whose issue is still open', async () => {
		await expect(reason_with({ issue_state: async () => 'OPEN' })).resolves.toBe(OPEN_REASON)
	})

	it('keeps a lane with uncommitted changes', async () => {
		await expect(reason_with({ is_tree_dirty: async () => true })).resolves.toBe(
			'it has uncommitted changes',
		)
	})

	it('keeps a lane holding commits that are on no remote, with the count', async () => {
		await expect(reason_with({ unpushed_commits: async () => UNPUSHED })).resolves.toBe(
			'it has 2 commit(s) that are on no remote',
		)
	})

	// A child that merged while no driver watched: spent on every other count, and still the run's.
	it('keeps a lane the running backlogrun has not collected yet', async () => {
		await expect(reason_with({ in_flight: async () => new Set([LANE.issue]) })).resolves.toBe(
			IN_FLIGHT_REASON,
		)
		await expect(
			reason_with({ in_flight: async () => new Set([OTHER.issue]) }),
		).resolves.toBeUndefined()
	})

	it('names the running child ahead of every other reason', async () => {
		const busy = { process_trace: (): 'alive' => 'alive', is_tree_dirty: async () => true }

		await expect(reason_with(busy)).resolves.toBe(CHILD_REASON)
	})
})

describe('lane_spent.kept_reason on a condition it could not read', () => {
	it('keeps a lane whose process probe did not answer', async () => {
		await expect(reason_with({ process_trace: () => 'unknown' })).resolves.toBe(
			'whether a child is working in it could not be read',
		)
	})

	it('keeps a lane whose issue could not be read', async () => {
		await expect(reason_with({ issue_state: async () => undefined })).resolves.toBe(
			UNREAD_ISSUE_REASON,
		)
	})

	it('keeps a lane whose commits could not be counted', async () => {
		await expect(reason_with({ unpushed_commits: async () => undefined })).resolves.toBe(
			UNCOUNTED_REASON,
		)
	})
})

// The probes `lane:prune` really reads through: a read that failed has to reach the verdict as "could
// not be read", never as the zero or the closed state that discards the lane.
describe('lane_spent.kept_reason through the live probes', () => {
	it('answers spent for a lane every live read clears', async () => {
		await expect(lane_spent.kept_reason(LANE)).resolves.toBeUndefined()
		expect(live.process_trace_default).toHaveBeenCalledWith(LANE.issue)
		expect(live.issue_view_json).toHaveBeenCalledExactlyOnceWith(LANE.issue, 'state')
		expect(live.is_tree_dirty).toHaveBeenCalledExactlyOnceWith(LANE.directory)
		expect(live.commit_count_unpushed).toHaveBeenCalledExactlyOnceWith(LANE.branch)
	})

	it('keeps a lane whose commit count threw rather than reading it as zero', async () => {
		live.commit_count_unpushed.mockRejectedValue(new Error('rather than a count'))

		await expect(lane_spent.kept_reason(LANE)).resolves.toBe(UNCOUNTED_REASON)
	})

	it('keeps a lane whose issue read came back empty or without a state', async () => {
		live.issue_view_json.mockResolvedValueOnce(undefined)
		await expect(lane_spent.kept_reason(LANE)).resolves.toBe(UNREAD_ISSUE_REASON)

		live.issue_view_json.mockResolvedValueOnce('{"message":"API rate limit exceeded"}')
		await expect(lane_spent.kept_reason(LANE)).resolves.toBe(UNREAD_ISSUE_REASON)
	})

	it('keeps a lane the run launched and has not settled, and frees it once merged', async () => {
		const launch = { pos: 1, at: LAUNCHED_AT, kind: 'child-launch', text: `#${LANE.issue}` }
		const merge = { pos: 2, at: LAUNCHED_AT, kind: 'merge', text: `#${LANE.issue}` }

		live.current_events.mockResolvedValueOnce([launch])
		await expect(lane_spent.kept_reason(LANE)).resolves.toBe(IN_FLIGHT_REASON)

		live.current_events.mockResolvedValueOnce([launch, merge])
		await expect(lane_spent.kept_reason(LANE)).resolves.toBeUndefined()
	})

	it('keeps a lane whose issue the live read reports open', async () => {
		live.issue_view_json.mockResolvedValue('{"state":"OPEN"}')

		await expect(lane_spent.kept_reason(LANE)).resolves.toBe(OPEN_REASON)
	})
})

describe('lane_spent.sort_lanes', () => {
	it('sorts each live lane as spent or kept and leaves a stranded one out', async () => {
		const stranded = { ...LANE, issue: '3000', is_stranded: true }
		const probes = probes_of({
			issue_state: async (issue) => (issue === LANE.issue ? 'CLOSED' : 'OPEN'),
		})

		await expect(lane_spent.sort_lanes([stranded, LANE, OTHER], probes)).resolves.toStrictEqual({
			spent: [LANE],
			kept: [{ issue: OTHER.issue, reason: OPEN_REASON }],
		})
	})
})

describe('lane_spent.lanes_in_use', () => {
	it('names only the lanes a child is working in', async () => {
		const probes = probes_of({
			process_trace: (issue) => (issue === OTHER.issue ? 'alive' : 'none'),
		})

		await expect(lane_spent.lanes_in_use(probes)).resolves.toStrictEqual({
			working: [OTHER.issue],
			unread: [],
		})
	})

	it('names a lane whose probe did not answer apart, and never a stranded one', async () => {
		const stranded = { ...OTHER, is_stranded: true }

		vi.mocked(lane_registry.list_lanes).mockResolvedValue([LANE, stranded])

		await expect(
			lane_spent.lanes_in_use(probes_of({ process_trace: () => 'unknown' })),
		).resolves.toStrictEqual({ working: [], unread: [LANE.issue] })
	})

	// A probe that times out and then answers: bucketed on two samples, the lane was in neither list.
	it('probes each lane once, so a probe that changes its answer still names the lane', async () => {
		const process_trace = vi
			.fn<SpentProbes['process_trace']>()
			.mockReturnValueOnce('unknown')
			.mockReturnValue('alive')

		vi.mocked(lane_registry.list_lanes).mockResolvedValue([LANE])

		await expect(lane_spent.lanes_in_use(probes_of({ process_trace }))).resolves.toStrictEqual({
			working: [],
			unread: [LANE.issue],
		})
		expect(process_trace).toHaveBeenCalledExactlyOnceWith(LANE.issue)
	})
})
