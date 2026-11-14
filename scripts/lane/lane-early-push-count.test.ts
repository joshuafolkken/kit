import { describe, expect, it } from 'vitest'
import { lane_early_push_count } from './lane-early-push-count'
import type { LedgerEntry } from './lane-ledger'

const AT = '2026-11-14T00:00:00.000Z'

function push(result: string, slots?: number): LedgerEntry {
	return {
		kind: 'early-push',
		at: AT,
		source: 'review',
		result,
		...(slots !== undefined && { slots }),
	}
}

describe('lane_early_push_count.multi_slot_pushed', () => {
	it('counts only pushed early pushes from a round with more than one slot', () => {
		const entries = [
			push('pushed', 2),
			push('pushed', 3),
			push('pushed', 1),
			push('pushed'),
			push('push-failed', 2),
			push('dirty-tree', 2),
			{ kind: 'stop', at: AT, issue: 7503, reason: 'gate' } as const,
		]

		expect(lane_early_push_count.multi_slot_pushed(entries)).toBe(2)
	})

	it('counts nothing on an empty ledger', () => {
		expect(lane_early_push_count.multi_slot_pushed([])).toBe(0)
	})
})
