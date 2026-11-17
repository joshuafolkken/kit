import { describe, expect, it } from 'vitest'
import { lane_ledger_schema } from './lane-ledger-schema'

// joshuafolkken/kit#7774: the split and push-miss kinds, moved to their own module, still parse.

const AT = '2026-11-17T00:00:00.000Z'

describe('lane_ledger_schema_split — the split and push-miss kinds, read through the entry union', () => {
	it('reads a split notice with its axis back as written', () => {
		const entry = { kind: 'split-notice', at: AT, issue: 7774, files: 3, lines: 150, reason: 'hub' }

		expect(lane_ledger_schema.entry_schema.parse(entry)).toEqual(entry)
	})

	it('rejects a push miss whose scope is neither whole nor related', () => {
		const entry = { kind: 'push-miss', at: AT, scope: 'partial', reason: 'tree' }

		expect(lane_ledger_schema.entry_schema.safeParse(entry).success).toBe(false)
	})
})
