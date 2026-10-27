import { describe, expect, it } from 'vitest'
import { lane_ledger_schema } from './lane-ledger-schema'

// The ledger's line shapes: a known kind parses, anything else is a line `read_entries` skips.

const { KIND, entry_schema } = lane_ledger_schema
const AT = '2026-10-22T00:00:00.000Z'

// joshuafolkken/kit#5078
describe('lane_ledger_schema.entry_schema on a test-pinned run', () => {
	it('parses a probe whose test file count is left out', () => {
		const run = {
			kind: KIND.TEST_PINNED,
			at: AT,
			issue: 5078,
			held: 2,
			probes: [{ file: 'scripts/a.ts', elapsed_ms: 5 }],
			elapsed_ms: 9,
		}

		expect(entry_schema.safeParse(run).data).toStrictEqual(run)
	})

	// joshuafolkken/kit#5235
	it('keeps the count of hunks it did not probe as a rewire', () => {
		const run = { kind: KIND.TEST_PINNED, at: AT, held: 0, rewired: 2, probes: [], elapsed_ms: 9 }

		expect(entry_schema.safeParse(run).data).toStrictEqual(run)
	})
})

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

	it('parses a full-suite test-related run with the files that sent it there', () => {
		const run = {
			kind: KIND.TEST_RELATED,
			at: AT,
			scope: 'whole-suite-file',
			changed: 2,
			synced: 0,
			since_map: 0,
			readers: 0,
			trigger_files: ['package.json', 'pnpm-lock.yaml'],
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

// joshuafolkken/kit#5168
describe('lane_ledger_schema.entry_schema — lane state', () => {
	it("parses a lane's pause or resume", () => {
		const line = { kind: KIND.LANE_STATE, at: AT, issue: 5168, state: 'paused' }

		expect(entry_schema.safeParse(line).success).toBe(true)
	})
})

// joshuafolkken/kit#4620: how a ship's round 1 ended, for `josh lane:stats`.
describe('lane_ledger_schema.entry_schema — round one', () => {
	it('parses the round 1 a ship acted on', () => {
		const round = { kind: KIND.ROUND_ONE, at: AT, issue: 4620, verdict: 'reused' }

		expect(entry_schema.safeParse(round).data).toStrictEqual(round)
	})
})
