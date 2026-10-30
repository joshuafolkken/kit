import { describe, expect, it } from 'vitest'
import { lane_ledger_pinned_origin } from './lane-ledger-pinned-origin'

describe('lane_ledger_pinned_origin', () => {
	it.each(['run-review', 'pre-detach', 'manual'])('accepts %s', (origin) => {
		expect(lane_ledger_pinned_origin.pinned_origin_schema.parse(origin)).toBe(origin)
	})

	it.each(['ship', '', undefined])('rejects an unknown origin %s', (origin) => {
		expect(lane_ledger_pinned_origin.pinned_origin_schema.safeParse(origin).success).toBe(false)
	})
})
