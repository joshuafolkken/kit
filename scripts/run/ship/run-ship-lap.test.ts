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
			async () => await run_ship_lap.timed(STEP, async () => 'done', { sink }),
		)

		expect(result).toBe('done')
		expect(laps.map(({ issue, stage, step }) => ({ issue, stage, step }))).toEqual([
			{ issue: Number(ISSUE), stage: STAGE, step: STEP },
		])
		expect(laps[0]?.elapsed_ms).toBeGreaterThanOrEqual(0)
	})

	it('records nothing outside a ship stage', async () => {
		const { laps, sink } = sink_of()

		await run_ship_lap.timed(STEP, async () => 'done', { sink })

		expect(laps).toEqual([])
	})

	it('records a step that threw and rethrows its error', async () => {
		const { laps, sink } = sink_of()
		const failing = vi.fn(async () => {
			throw new Error(FAILURE)
		})

		await expect(
			run_ship_lap.within(
				ISSUE,
				STAGE,
				async () => await run_ship_lap.timed(STEP, failing, { sink }),
			),
		).rejects.toThrow(FAILURE)
		expect(laps.map((lap) => lap.step)).toEqual([STEP])
	})
})

// joshuafolkken/kit#5531: why a scoped check read the whole branch, carried on its lap.
describe('run_ship_lap.timed — the fallback note', () => {
	it('records the note the step result carries', async () => {
		const { laps, sink } = sink_of()

		await run_ship_lap.within(
			ISSUE,
			STAGE,
			async () =>
				await run_ship_lap.timed(STEP, async () => 'out', {
					sink,
					note_of: () => ({ fallback: 'hub' }),
				}),
		)

		expect(laps[0]?.fallback).toBe('hub')
	})

	it('records no fallback when the note is absent', async () => {
		const { laps, sink } = sink_of()

		await run_ship_lap.within(
			ISSUE,
			STAGE,
			async () => await run_ship_lap.timed(STEP, async () => 'out', { sink, note_of: () => ({}) }),
		)

		expect(laps[0]).not.toHaveProperty('fallback')
	})
})

// joshuafolkken/kit#5538: which run of the scoped pair a lap was, and why it ran again.
describe('run_ship_lap.timed — the rerun note', () => {
	it('records the run count and the rerun reason the note carries', async () => {
		const { laps, sink } = sink_of()

		await run_ship_lap.within(
			ISSUE,
			STAGE,
			async () =>
				await run_ship_lap.timed(STEP, async () => 'out', {
					sink,
					note_of: () => ({ runs: 2, rerun: 'moved' }),
				}),
		)

		expect(laps[0]).toMatchObject({ runs: 2, rerun: 'moved' })
	})
})

// joshuafolkken/kit#5831: a step timed under a parent, in this process or a child it spawned.
const PARENT = 'josh git'
const CHILD_STEP = 'commit'

describe('run_ship_lap — a parent scope', () => {
	it('names a lap within a parent scope `<parent> › <step>`', async () => {
		const { laps, sink } = sink_of()

		await run_ship_lap.within(
			ISSUE,
			STAGE,
			async () => await run_ship_lap.timed(CHILD_STEP, async () => 'out', { sink }),
			PARENT,
		)

		expect(laps.map((lap) => lap.step)).toEqual([`${PARENT} › ${CHILD_STEP}`])
		expect(laps[0]).not.toHaveProperty('parent')
	})
})

describe('run_ship_lap.environment — a scope handed to a child process', () => {
	it('hands its scope to a child process, which times its steps under the parent', async () => {
		const { laps, sink } = sink_of()
		const environment = await run_ship_lap.within(ISSUE, STAGE, async () =>
			run_ship_lap.environment(PARENT),
		)

		vi.stubEnv(run_ship_lap.ENVIRONMENT_KEY, environment[run_ship_lap.ENVIRONMENT_KEY])
		await run_ship_lap.timed(CHILD_STEP, async () => 'out', { sink })
		vi.unstubAllEnvs()

		expect(laps.map(({ issue, stage, step }) => ({ issue, stage, step }))).toEqual([
			{ issue: Number(ISSUE), stage: STAGE, step: `${PARENT} › ${CHILD_STEP}` },
		])
	})

	it('hands nothing down outside any scope', () => {
		expect(run_ship_lap.environment(PARENT)).toEqual({})
	})

	it('times nothing under an unreadable inherited scope', async () => {
		const { laps, sink } = sink_of()

		vi.stubEnv(run_ship_lap.ENVIRONMENT_KEY, '{not json')
		await run_ship_lap.timed(CHILD_STEP, async () => 'out', { sink })
		vi.unstubAllEnvs()

		expect(laps).toEqual([])
	})
})
