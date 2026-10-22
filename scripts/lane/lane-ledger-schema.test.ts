import { describe, expect, it } from 'vitest'
import { lane_ledger_schema } from './lane-ledger-schema'

// The ledger's line shapes: a known kind parses, anything else is a line `read_entries` skips.

const { KIND, entry_schema } = lane_ledger_schema
const AT = '2026-10-22T00:00:00.000Z'

describe('lane_ledger_schema.entry_schema', () => {
	it('parses a test-related run with its test file count left out', () => {
		const run = {
			kind: KIND.TEST_RELATED,
			at: AT,
			scope: 'no-map',
			changed: 1,
			synced: 0,
			since_map: 0,
			readers: 0,
			elapsed_ms: 5,
		}

		expect(entry_schema.safeParse(run).data).toStrictEqual(run)
	})

	it('rejects a line of a kind it does not know', () => {
		expect(entry_schema.safeParse({ kind: 'unknown', at: AT }).success).toBe(false)
	})

	it('rejects a known kind missing a field', () => {
		expect(entry_schema.safeParse({ kind: KIND.MERGE, at: AT }).success).toBe(false)
	})
})
