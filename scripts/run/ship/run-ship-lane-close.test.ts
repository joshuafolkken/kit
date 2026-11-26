import { issue_merged } from '#scripts/issue/issue-merged'
import { lane_close, type CloseOutcome } from '#scripts/lane/lane-close'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_spent } from '#scripts/lane/lane-spent'
import { run_tidy_stashes } from '#scripts/run/tidy/run-tidy-stashes'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_ship_lane_close, type LaneCloseProbes } from './run-ship-lane-close'

// joshuafolkken/kit#9038: a merged lane child's lane was left open on every launch path but one.

const ISSUE = '9038'
const MAIN_ROOT = '/repo'
const LANE: LaneInfo = {
	issue: ISSUE,
	branch: '9038-lane',
	directory: '/lanes/9038',
	seat: 1,
	development_port: 5173,
	preview_port: 4173,
	output: undefined,
	is_stranded: false,
}
const CLOSED: CloseOutcome = {
	issue: ISSUE,
	kind: 'closed',
	left_behind: [],
	reaped: [],
	residents: [],
}
const DROPPED = { target: 'stash "On main: parked #9038"', verdict: { kind: 'clean' } as const }
const INSIDE_LANE = '/lanes/9038/scripts'
const REPORTED = [['lane #9038 closed'], [`dropped ${DROPPED.target}`]]

function probes_of(overrides: Partial<LaneCloseProbes> = {}): LaneCloseProbes {
	return {
		find_lane: vi.fn(async () => LANE),
		cwd: () => INSIDE_LANE,
		kept_reason: async () => undefined,
		main_root: async () => MAIN_ROOT,
		chdir: vi.fn(),
		close: vi.fn(async () => CLOSED),
		tidy_stashes: vi.fn(async () => [DROPPED]),
		print: vi.fn(),
		...overrides,
	}
}

describe('run_ship_lane_close.close_merged — a spent lane', () => {
	it('steps out to the main checkout, then closes the lane and drops its stashes', async () => {
		const probes = probes_of()

		await run_ship_lane_close.close_merged(ISSUE, probes)

		expect(probes.chdir).toHaveBeenCalledExactlyOnceWith(MAIN_ROOT)
		expect(probes.close).toHaveBeenCalledExactlyOnceWith(ISSUE)
		expect(probes.tidy_stashes).toHaveBeenCalledExactlyOnceWith(ISSUE)
		expect(vi.mocked(probes.chdir).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(probes.close).mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('reports the close and each stash', async () => {
		const probes = probes_of()

		await run_ship_lane_close.close_merged(ISSUE, probes)

		expect(vi.mocked(probes.print).mock.calls).toStrictEqual(REPORTED)
	})

	it('names what an incomplete close left behind', async () => {
		const incomplete = { ...CLOSED, kind: 'incomplete' as const, left_behind: ['branch'] }
		const probes = probes_of({ close: async () => incomplete, tidy_stashes: async () => [] })

		await run_ship_lane_close.close_merged(ISSUE, probes)

		expect(probes.print).toHaveBeenCalledExactlyOnceWith(
			'lane #9038 incomplete; left behind: branch',
		)
	})
})

describe('run_ship_lane_close.close_merged — a lane it leaves open', () => {
	it('keeps a lane holding work, with the reason, and closes nothing', async () => {
		const probes = probes_of({ kept_reason: async () => 'it has uncommitted changes' })

		await run_ship_lane_close.close_merged(ISSUE, probes)

		expect(probes.print).toHaveBeenCalledExactlyOnceWith(
			'lane #9038 kept: it has uncommitted changes',
		)
		expect(probes.close).not.toHaveBeenCalled()
		expect(probes.chdir).not.toHaveBeenCalled()
	})

	it('does nothing for a ship run outside the lane or with no lane', async () => {
		const outside = probes_of({ cwd: () => '/lanes/90380' })
		const none = probes_of({ find_lane: async () => undefined })

		await run_ship_lane_close.close_merged(ISSUE, outside)
		await run_ship_lane_close.close_merged(ISSUE, none)

		expect(outside.close).not.toHaveBeenCalled()
		expect(none.close).not.toHaveBeenCalled()
		expect(outside.print).not.toHaveBeenCalled()
	})

	it('reports a failed close instead of throwing', async () => {
		const probes = probes_of({
			close: async () => {
				throw new Error('busy')
			},
		})

		await expect(run_ship_lane_close.close_merged(ISSUE, probes)).resolves.toBeUndefined()
		expect(probes.print).toHaveBeenCalledExactlyOnceWith('lane #9038 not closed: busy')
	})
})

// The live probes `close_merged` uses when none are passed, each reaching the module it names.
function stub_live(): void {
	vi.spyOn(lane_registry, 'list_lanes').mockResolvedValue([LANE])
	vi.spyOn(lane_registry, 'main_repository_root').mockResolvedValue(MAIN_ROOT)
	vi.spyOn(lane_spent, 'merged_kept_reason').mockResolvedValue(undefined)
	vi.spyOn(lane_close, 'close_lane').mockResolvedValue(CLOSED)
	vi.spyOn(run_tidy_stashes, 'tidy_issue_stashes').mockResolvedValue([DROPPED])
	vi.spyOn(process, 'cwd').mockReturnValue(INSIDE_LANE)
	vi.spyOn(process, 'chdir').mockReturnValue()
	vi.spyOn(console, 'info').mockReturnValue()
}

describe('run_ship_lane_close.close_merged — the live probes', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('steps out to the main checkout, closes the lane and tidies its stashes', async () => {
		stub_live()
		await run_ship_lane_close.close_merged(ISSUE)

		expect(lane_spent.merged_kept_reason).toHaveBeenCalledWith(LANE)
		expect(process.chdir).toHaveBeenCalledWith(MAIN_ROOT)
		expect(lane_close.close_lane).toHaveBeenCalledWith(ISSUE)
		expect(run_tidy_stashes.tidy_issue_stashes).toHaveBeenCalledWith(
			ISSUE,
			issue_merged.read_merged,
		)
		expect(vi.mocked(console.info).mock.calls).toStrictEqual(REPORTED)
	})
})
