import { describe, expect, it } from 'vitest'
import { lane_ledger_schema } from './lane-ledger-schema'

// joshuafolkken/kit#7639: a `test:related` row carries the files the cap left at their whole reach.

const ROW = {
	kind: 'test-related',
	at: '2026-11-16T00:00:00.000Z',
	scope: 'related',
	changed: 3,
	synced: 0,
	since_map: 0,
	readers: 1,
	over_cap: 2,
	over_cap_hub: 'scripts/hub.ts',
	elapsed_ms: 1000,
}

describe('lane_ledger_schema_related — the test:related row, read through the entry union', () => {
	it('reads a row with its full-reach files back as written', () => {
		const row = { ...ROW, full_reach: [{ file: 'scripts/wide.ts', reached: 1777 }] }

		expect(lane_ledger_schema.entry_schema.parse(row)).toEqual(row)
	})

	it('reads a row written before the full-reach files were recorded', () => {
		expect(lane_ledger_schema.entry_schema.parse(ROW)).toEqual(ROW)
	})

	// joshuafolkken/kit#7828: the rebuild, the core wait and vitest, each timed.
	it('reads a row with its stage times back as written', () => {
		const row = { ...ROW, rebuild_ms: 4000, core_wait_ms: 1200, vitest_ms: 9000 }

		expect(lane_ledger_schema.entry_schema.parse(row)).toEqual(row)
	})

	it('reads a row that timed only some stages', () => {
		const row = { ...ROW, vitest_ms: 9000 }

		expect(lane_ledger_schema.entry_schema.parse(row)).toEqual(row)
	})
})
