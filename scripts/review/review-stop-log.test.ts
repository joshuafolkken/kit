import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { review_stop_log } from './review-stop-log'

// joshuafolkken/kit#4519: every finding that stopped a review is kept, one line each, in a log a reboot
// does not clear.

const FINDING = { kind: 'bug-risks:medium', location: 'a.ts:3', sentence: 'the guard is stale.' }
const OTHER = { kind: 'tests:high', location: 'b.test.ts', sentence: '' }
const REVIEW = 'review'

// A log path whose directory does not exist yet, removed when the test ends.
function fresh_log(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'review-stop-log-'))

	onTestFinished(() => {
		rmSync(directory, { recursive: true, force: true })
	})

	return path.join(directory, 'josh', 'review-stops.jsonl')
}

describe('review_stop_log.record and read', () => {
	it('appends one line per finding, creating its directory, and reads them back in order', () => {
		const log = fresh_log()

		review_stop_log.record({ issue: 7, stage: REVIEW, findings: [FINDING, OTHER] }, log)
		review_stop_log.record({ issue: 8, stage: 'round-2', findings: [OTHER] }, log)

		const lines = review_stop_log.read(log)

		expect(lines.map(({ at: _at, ...rest }) => rest)).toStrictEqual([
			{ issue: 7, stage: REVIEW, ...FINDING },
			{ issue: 7, stage: REVIEW, ...OTHER },
			{ issue: 8, stage: 'round-2', ...OTHER },
		])
		expect(Number.isNaN(Date.parse(lines[0]?.at ?? ''))).toBe(false)
	})

	it('writes nothing for a stop no finding decided', () => {
		const log = fresh_log()

		review_stop_log.record({ issue: 7, stage: 'gate', findings: [] }, log)

		expect(review_stop_log.read(log)).toStrictEqual([])
	})

	it('skips a malformed line rather than dropping the whole log', () => {
		const log = fresh_log()

		review_stop_log.record({ issue: 7, stage: REVIEW, findings: [FINDING] }, log)
		appendFileSync(log, '{"cut short\n')
		review_stop_log.record({ issue: 9, stage: REVIEW, findings: [OTHER] }, log)

		expect(review_stop_log.read(log).map((line) => line.issue)).toStrictEqual([7, 9])
	})

	it('has no log under a test run, so a suite never writes the real one', () => {
		expect(review_stop_log.target()).toBeUndefined()
		expect(review_stop_log.read()).toStrictEqual([])
	})
})

describe('review_stop_log.record — a round that passed on fixes made in place', () => {
	it('marks each of its findings fixed', () => {
		const log = fresh_log()

		review_stop_log.record({ issue: 7, stage: REVIEW, findings: [FINDING], is_fixed: true }, log)

		expect(review_stop_log.read(log).map(({ at: _at, ...rest }) => rest)).toStrictEqual([
			{ issue: 7, stage: REVIEW, ...FINDING, fixed: true },
		])
	})
})
