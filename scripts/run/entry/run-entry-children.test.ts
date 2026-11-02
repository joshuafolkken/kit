import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_entry_children } from './run-entry-children'

// joshuafolkken/kit#5831: `run:entry` times each child it runs under `run:entry › <step>`.

const { record_ship_lap } = vi.hoisted(() => ({ record_ship_lap: vi.fn(async () => undefined) }))

vi.mock('#scripts/lane/lane-ledger-write', () => ({ lane_ledger_write: { record_ship_lap } }))

const ISSUE = '5831'

beforeEach(() => {
	record_ship_lap.mockClear()
})

describe('run_entry_children.STEP — the lap names lane:breakdown prints', () => {
	it('keeps each child step name fixed', () => {
		expect(run_entry_children.STEP).toEqual({
			RESUME: 'run:cut --resume',
			STAGE: 'stage read',
			HOLD: 'run:hold',
			COST: 'cost --cut',
			SYNC: 'sync',
			LABEL: 'label',
			PREP: 'run:prep',
			PROBE: 'lane:plan probe',
			LANE_PLAN: 'lane:plan',
			BASELINE: 'issue baseline',
			REPORT: 'report',
		})
	})
})

describe('run_entry_children.within — the entry scope', () => {
	it('records a step timed within it as `run:entry › <step>`', async () => {
		const result = await run_entry_children.within(
			ISSUE,
			async () => await run_entry_children.timed(run_entry_children.STEP.PREP, async () => 'read'),
		)

		expect(result).toBe('read')
		expect(record_ship_lap).toHaveBeenCalledWith(
			expect.objectContaining({
				issue: Number(ISSUE),
				stage: 'run:entry',
				step: 'run:entry › run:prep',
			}),
		)
	})

	it('records nothing for a step timed outside it', async () => {
		await run_entry_children.timed(run_entry_children.STEP.PREP, async () => 'read')

		expect(record_ship_lap).not.toHaveBeenCalled()
	})
})
