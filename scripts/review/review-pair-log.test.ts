import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { review_pair_log, type PairLine } from './review-pair-log'

// joshuafolkken/kit#6902: each paired comparison is one line in a ledger a lane worktree's removal does
// not take with it.

const LINE: PairLine = {
	at: '2026-11-09T00:00:00.000Z',
	issue: 6902,
	opus: {
		agent: 'o',
		model: 'claude-opus-5-5',
		usd: 1,
		findings: [{ severity: 'high', line: 'x' }],
	},
	sonnet: { agent: 's', findings: [] },
}
const make_directory = temporary_directory()

function fresh_log(): string {
	return path.join(make_directory('review-pair-log-'), 'josh', 'review-pairs.jsonl')
}

describe('review_pair_log.record and read', () => {
	it('appends a comparison, creating its directory, and reads it back', () => {
		const log = fresh_log()

		expect(review_pair_log.record(LINE, log)).toBe(true)
		expect(review_pair_log.read(log)).toStrictEqual([LINE])
	})

	it('skips a malformed line and records nothing without a ledger', () => {
		const log = fresh_log()

		review_pair_log.record(LINE, log)
		appendFileSync(log, '{"issue":\n')

		expect(review_pair_log.read(log)).toHaveLength(1)
		expect(review_pair_log.record(LINE)).toBe(false)
	})

	it('has no ledger under the test runner', () => {
		expect(review_pair_log.target()).toBeUndefined()
	})
})
