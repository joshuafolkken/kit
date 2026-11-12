import { describe, expect, it } from 'vitest'
import { lane_ledger_schema } from './lane-ledger-schema'

// joshuafolkken/kit#7306: one `backlog:next` answer's `offer` line parses through the entry union.

const OFFER = {
	kind: 'offer',
	at: '2026-11-11T15:11:00.000Z',
	verdict: 'run',
	seen: [7303, 7304],
	started: [7303],
	excluded: [{ issue: 7304, reason: 'triage' }],
	is_unchanged: false,
}

describe('lane_ledger_schema — the offer entry', () => {
	it('parses an ask decision', () => {
		expect(lane_ledger_schema.entry_schema.parse(OFFER)).toStrictEqual(OFFER)
	})

	it('refuses an exclusion that names no reason', () => {
		const excluded = [{ issue: 7304 }]

		expect(lane_ledger_schema.entry_schema.safeParse({ ...OFFER, excluded }).success).toBe(false)
	})
})
