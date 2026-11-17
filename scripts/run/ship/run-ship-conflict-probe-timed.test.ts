import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_ship_conflict_probe } from './run-ship-conflict-probe'
import { run_ship_conflict_probe_timed } from './run-ship-conflict-probe-timed'

// joshuafolkken/kit#7737: the detached ship's foreground probe reaches the ledger, not only the output.
// The probe's own branches are pinned with real git in `run-ship-conflict-probe.test.ts`.

const ISSUE = '7737'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_ship_conflict_probe_timed.probe', () => {
	it('records the probe as the sync stage conflict probe lap of the issue', async () => {
		const recorded = vi.spyOn(lane_ledger_write, 'record_ship_lap').mockResolvedValue()

		vi.spyOn(run_ship_conflict_probe, 'probe').mockResolvedValue(undefined)
		await run_ship_conflict_probe_timed.probe(ISSUE)

		expect(recorded).toHaveBeenCalledWith(
			expect.objectContaining({ issue: Number(ISSUE), stage: 'sync', step: 'conflict probe' }),
		)
	})
})
