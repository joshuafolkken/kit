import { describe, expect, it } from 'vitest'
import { lane_ledger_kind } from './lane-ledger-kind'

describe('lane_ledger_kind.KIND — the discriminant of each ledger line', () => {
	it('names every kind once, so no two schemas share a discriminant', () => {
		const kinds = Object.values(lane_ledger_kind.KIND)

		expect(new Set(kinds).size).toBe(kinds.length)
	})
})
