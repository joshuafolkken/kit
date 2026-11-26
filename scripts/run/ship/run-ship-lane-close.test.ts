import type { CloseOutcome } from '#scripts/lane/lane-close'
import type { LaneInfo } from '#scripts/lane/lane-registry'
import { describe, expect, it, vi } from 'vitest'
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

function probes_of(overrides: Partial<LaneCloseProbes> = {}): LaneCloseProbes {
	return {
		find_lane: vi.fn(async () => LANE),
		cwd: () => '/lanes/9038/scripts',
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

		expect(vi.mocked(probes.print).mock.calls).toStrictEqual([
			['lane #9038 closed'],
			[`dropped ${DROPPED.target}`],
		])
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
