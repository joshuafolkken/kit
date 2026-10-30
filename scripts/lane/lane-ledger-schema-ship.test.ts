import { describe, expect, it } from 'vitest'
import { lane_ledger_schema } from './lane-ledger-schema'

const AT = '2026-10-28T00:00:00.000Z'
const LAP = {
	kind: 'ship-lap',
	at: AT,
	issue: 5294,
	stage: 'gate',
	step: 'josh gate',
	elapsed_ms: 1200,
}

describe('lane_ledger_schema_ship — the lines josh ship writes, read through the entry union', () => {
	it('reads a size measurement back through the ledger union', () => {
		const size = {
			kind: 'size',
			at: AT,
			issue: 5384,
			declared: { files: 7, lines: 160 },
			actual: { files: 12, lines: 300 },
		}

		expect(lane_ledger_schema.entry_schema.parse(size)).toEqual(size)
	})

	it('reads a ship lap back as written', () => {
		expect(lane_ledger_schema.entry_schema.parse(LAP)).toEqual(LAP)
	})

	it('refuses a ship lap with no step', () => {
		const missing = { ...LAP, step: undefined }

		expect(lane_ledger_schema.entry_schema.safeParse(missing).success).toBe(false)
	})

	it('reads a ship stop back as written', () => {
		const stop = { kind: 'stop', at: AT, issue: 5294, reason: 'gate', cause: 'check' }

		expect(lane_ledger_schema.entry_schema.parse(stop)).toEqual(stop)
	})
})
