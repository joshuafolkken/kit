import type { ShipLapRecord } from '#scripts/lane/lane-ledger-schema'
import { describe, expect, it, vi } from 'vitest'
import { run_ship_lap } from './run-ship-lap'

const ISSUE = '5294'
const STAGE = 'sync'
const STEP = 'overlap wait'
const FAILURE = 'merge failed'

function sink_of(): { laps: Array<ShipLapRecord>; sink: (lap: ShipLapRecord) => Promise<void> } {
	const laps: Array<ShipLapRecord> = []

	return {
		laps,
		sink: async (lap) => {
			laps.push(lap)
			await Promise.resolve()
		},
	}
}

describe('run_ship_lap.timed — an inner step of a ship stage', () => {
	it('records the step under the stage and issue it runs within', async () => {
		const { laps, sink } = sink_of()

		const result = await run_ship_lap.within(
			ISSUE,
			STAGE,
			async () => await run_ship_lap.timed(STEP, async () => 'done', sink),
		)

		expect(result).toBe('done')
		expect(laps.map(({ issue, stage, step }) => ({ issue, stage, step }))).toEqual([
			{ issue: Number(ISSUE), stage: STAGE, step: STEP },
		])
		expect(laps[0]?.elapsed_ms).toBeGreaterThanOrEqual(0)
	})

	it('records nothing outside a ship stage', async () => {
		const { laps, sink } = sink_of()

		await run_ship_lap.timed(STEP, async () => 'done', sink)

		expect(laps).toEqual([])
	})

	it('records a step that threw and rethrows its error', async () => {
		const { laps, sink } = sink_of()
		const failing = vi.fn(async () => {
			throw new Error(FAILURE)
		})

		await expect(
			run_ship_lap.within(ISSUE, STAGE, async () => await run_ship_lap.timed(STEP, failing, sink)),
		).rejects.toThrow(FAILURE)
		expect(laps.map((lap) => lap.step)).toEqual([STEP])
	})
})
