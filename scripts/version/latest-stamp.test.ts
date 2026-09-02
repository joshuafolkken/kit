import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { latest_stamp, type LatestStamp } from './latest-stamp'

// joshuafolkken/kit#1215: `josh latest` ran at the head of every run and cost 60–120 seconds of
// network time to answer the same thing several times a day. The record here is what turns "should I
// update?" from a judgement into an elapsed-time reading.

const scratch = mkdtempSync(path.join(tmpdir(), 'josh-latest-stamp-test-'))
const NOW = new Date('2026-09-02T12:00:00.000Z')
const HOURS_AGO_2 = { ran_at: '2026-09-02T10:00:00.000Z' } satisfies LatestStamp
const HOURS_AGO_20 = { ran_at: '2026-09-01T16:00:00.000Z' } satisfies LatestStamp
const SLIGHTLY_AHEAD = { ran_at: '2026-09-02T13:00:00.000Z' } satisfies LatestStamp
const FAR_AHEAD = { ran_at: '2026-09-03T12:00:00.000Z' } satisfies LatestStamp

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

describe('latest_stamp.hours_since', () => {
	it('measures the age of a record in hours', () => {
		expect(latest_stamp.hours_since(HOURS_AGO_2, NOW)).toBe(2)
	})

	it('is negative for a record dated ahead of now', () => {
		expect(latest_stamp.hours_since(SLIGHTLY_AHEAD, NOW)).toBeLessThan(0)
	})
})

describe('latest_stamp.is_fresh', () => {
	it('is fresh inside the window', () => {
		expect(latest_stamp.is_fresh(HOURS_AGO_2, NOW, latest_stamp.DEFAULT_MAX_AGE_HOURS)).toBe(true)
	})

	it('is stale past the window', () => {
		expect(latest_stamp.is_fresh(HOURS_AGO_20, NOW, latest_stamp.DEFAULT_MAX_AGE_HOURS)).toBe(false)
	})

	// Ordinary clock skew. Reading it as stale would update on every invocation until the clock
	// caught up — the failure this command removes.
	it('reads a record a little ahead of now as fresh', () => {
		expect(latest_stamp.is_fresh(SLIGHTLY_AHEAD, NOW, latest_stamp.DEFAULT_MAX_AGE_HOURS)).toBe(
			true,
		)
	})

	// A badly skewed clock, or a record copied from another machine. Unbounded on this side, one such
	// record would answer `skip` for as long as the checkout exists and switch updates off silently.
	it('reads a record far ahead of now as stale', () => {
		expect(latest_stamp.is_fresh(FAR_AHEAD, NOW, latest_stamp.DEFAULT_MAX_AGE_HOURS)).toBe(false)
	})

	// The boundary belongs to the stale side: at exactly the window the update is due.
	it('is stale at exactly the window', () => {
		expect(latest_stamp.is_fresh(HOURS_AGO_2, NOW, 2)).toBe(false)
	})
})

describe('latest_stamp.read_max_age_hours', () => {
	it('falls back to the default when the variable is unset', () => {
		expect(latest_stamp.read_max_age_hours({})).toBe(latest_stamp.DEFAULT_MAX_AGE_HOURS)
	})

	it('reads a positive number from the variable', () => {
		expect(latest_stamp.read_max_age_hours({ [latest_stamp.MAX_AGE_ENV_VAR]: '3' })).toBe(3)
	})

	// A misspelled value must not silently disable the update, and a zero or negative window would
	// ask for it on every run while looking like a configured choice.
	it.each(['', 'soon', '0', '-4'])('falls back to the default for %j', (raw) => {
		expect(latest_stamp.read_max_age_hours({ [latest_stamp.MAX_AGE_ENV_VAR]: raw })).toBe(
			latest_stamp.DEFAULT_MAX_AGE_HOURS,
		)
	})
})

describe('latest_stamp.write_stamp and read_stamp', () => {
	it('reads back the run it recorded', () => {
		const target = path.join(scratch, 'round-trip.json')

		latest_stamp.write_stamp(target)

		expect(Date.parse(latest_stamp.read_stamp(target)?.ran_at ?? '')).not.toBeNaN()
	})

	it('answers with no record when the file is not there', () => {
		expect(latest_stamp.read_stamp(path.join(scratch, 'absent.json'))).toBeUndefined()
	})

	it('answers with no record when the file cannot be parsed', () => {
		const target = path.join(scratch, 'corrupt.json')

		writeFileSync(target, '{ not json')

		expect(latest_stamp.read_stamp(target)).toBeUndefined()
	})

	// A hand-edited record has to answer "no record" rather than reach the comparison as a lie.
	it.each([{ ran_at: 42 }, { ran_at: 'whenever' }, {}])(
		'answers with no record for json of the wrong shape %j',
		(payload) => {
			const target = path.join(scratch, 'wrong-shape.json')

			writeFileSync(target, JSON.stringify(payload))

			expect(latest_stamp.read_stamp(target)).toBeUndefined()
		},
	)
})

describe('latest_stamp.stamp_path', () => {
	it('is a json file in the temp directory keyed to this checkout', () => {
		expect(path.basename(latest_stamp.stamp_path())).toMatch(/^josh-latest-stamp-[\da-f]+\.json$/u)
	})
})
