import { describe, expect, it } from 'vitest'
import { lane_ledger_schema } from './lane-ledger-schema'

// The ledger's line shapes: a known kind parses, anything else is a line `read_entries` skips.

const { KIND, entry_schema } = lane_ledger_schema
const AT = '2026-10-22T00:00:00.000Z'
const PROBED = 'scripts/a.ts'

describe('lane_ledger_schema.entry_schema — test reuse', () => {
	it('preserves reuse counts, reason and comparison time on a related run', () => {
		const run = {
			kind: KIND.TEST_RELATED,
			at: AT,
			scope: 'related',
			changed: 1,
			synced: 1,
			since_map: 0,
			readers: 1,
			elapsed_ms: 5,
			reused: 1,
			reuse_missed: 1,
			reuse_reason: 'matched-inputs',
			reuse_elapsed_ms: 1,
		}

		expect(entry_schema.safeParse(run).data).toStrictEqual(run)
	})
})

// joshuafolkken/kit#5078
describe('lane_ledger_schema.entry_schema on a test-pinned run', () => {
	it('parses a probe whose test file count is left out', () => {
		const run = {
			kind: KIND.TEST_PINNED,
			at: AT,
			issue: 5078,
			held: 2,
			probes: [{ file: PROBED, elapsed_ms: 5 }],
			elapsed_ms: 9,
		}

		expect(entry_schema.safeParse(run).data).toStrictEqual(run)
	})

	// joshuafolkken/kit#5235
	it('keeps the count of hunks it did not probe as a rewire', () => {
		const run = { kind: KIND.TEST_PINNED, at: AT, held: 0, rewired: 2, probes: [], elapsed_ms: 9 }

		expect(entry_schema.safeParse(run).data).toStrictEqual(run)
	})

	// joshuafolkken/kit#5262
	it('keeps the origin that started it and the discarded mark, and rejects an unknown origin', () => {
		const run = {
			kind: KIND.TEST_PINNED,
			at: AT,
			held: 0,
			probes: [],
			elapsed_ms: 9,
			origin: 'run-review',
			discarded: true,
		}

		expect(entry_schema.safeParse(run).data).toStrictEqual(run)
		expect(entry_schema.safeParse({ ...run, origin: 'ship' }).success).toBe(false)
	})
})

// joshuafolkken/kit#5385
describe('lane_ledger_schema.entry_schema on a test-pinned probe', () => {
	it('keeps a probe the type check pinned, and rejects an unknown pinner', () => {
		const probe = { file: PROBED, elapsed_ms: 5, pinned_by: 'type-check' }
		const run = { kind: KIND.TEST_PINNED, at: AT, held: 0, probes: [probe], elapsed_ms: 9 }
		const unknown = { ...run, probes: [{ ...probe, pinned_by: 'lint' }] }

		expect(entry_schema.safeParse(run).data).toStrictEqual(run)
		expect(entry_schema.safeParse(unknown).success).toBe(false)
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

// joshuafolkken/kit#5295: followup's CI wait keeps its critical path.
describe('lane_ledger_schema.entry_schema — the ci-wait critical path', () => {
	it('keeps the last check to settle and each check time on a stage row', () => {
		const row = {
			kind: KIND.STAGE,
			at: AT,
			stage: 'ci-wait',
			elapsed_ms: 9,
			issue: 5295,
			last_check: 'e2e',
			check_ms: { lint: 3, e2e: 8 },
		}

		expect(entry_schema.safeParse(row).data).toStrictEqual(row)
	})
})
