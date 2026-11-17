import { describe, expect, it } from 'vitest'
import { lane_ledger_schema } from './lane-ledger-schema'

// joshuafolkken/kit#7774: the review-round and pacing kinds, moved to their own module, still parse.

const AT = '2026-11-17T00:00:00.000Z'

describe('lane_ledger_schema_round — the round and pacing kinds, read through the entry union', () => {
	it('reads a round-two decision back as written', () => {
		const entry = { kind: 'round-two', at: AT, issue: 7774, verdict: 'skip', code: 'clean' }

		expect(lane_ledger_schema.entry_schema.parse(entry)).toEqual(entry)
	})

	it('reads a core admission under the core-wait shape back as written', () => {
		const entry = { kind: 'core-admission', at: AT, command: 'gate', waited_ms: 0, overflow: true }

		expect(lane_ledger_schema.entry_schema.parse(entry)).toEqual(entry)
	})
})
