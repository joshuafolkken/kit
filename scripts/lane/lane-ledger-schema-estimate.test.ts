import { describe, expect, it } from 'vitest'
import { lane_ledger_schema } from './lane-ledger-schema'

// joshuafolkken/kit#7775: the run's finish estimate, read through the entry union.

const AT = '2026-11-17T00:00:00.000Z'
const FINISH_AT = '2026-11-17T02:00:00.000Z'

describe('lane_ledger_schema_estimate — the estimate kind, read through the entry union', () => {
	it('reads an estimate back as written', () => {
		const entry = { kind: 'estimate', at: AT, issue: 7775, run: AT, finish_at: FINISH_AT }

		expect(lane_ledger_schema.entry_schema.parse(entry)).toEqual(entry)
	})

	it('rejects an estimate with no finish', () => {
		const entry = { kind: 'estimate', at: AT, issue: 7775, run: AT }

		expect(lane_ledger_schema.entry_schema.safeParse(entry).success).toBe(false)
	})
})

// joshuafolkken/kit#8954: the size an Issue declared as its lane planned.
describe('lane_ledger_schema_estimate — the declared kind, read through the entry union', () => {
	it('reads a declared size back as written', () => {
		const entry = { kind: 'declared', at: AT, issue: 8954, files: 12, lines: 310 }

		expect(lane_ledger_schema.entry_schema.parse(entry)).toEqual(entry)
	})

	it('rejects a declared size with no lines', () => {
		const entry = { kind: 'declared', at: AT, issue: 8954, files: 12 }

		expect(lane_ledger_schema.entry_schema.safeParse(entry).success).toBe(false)
	})
})
