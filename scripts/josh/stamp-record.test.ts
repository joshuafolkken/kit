import { json_value } from '#scripts/lib/json-value'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { stamp_record, type StampRecordSpec } from './stamp-record'

// joshuafolkken/kit#3595: the expiry and the classification `run-carry.ts`, `run-cut.ts` and
// `run-hold.ts` each kept a copy of. The cases below are the decisions a copy could drift on.

const NOW = new Date('2026-01-01T12:00:00.000Z')
const MAX_AGE_MS = 1000
const AT_BOUND = '2026-01-01T11:59:59.000Z'
const PAST_BOUND = '2026-01-01T11:59:58.999Z'
const AHEAD_OF_NOW = '2026-01-02T12:00:00.000Z'

interface Sample {
	at: string
}

const sample_schema = z.object({ at: z.string() })

function parse_sample(raw: string): Sample | undefined {
	return json_value.parse_with(raw, sample_schema)
}

function at_of(sample: Sample): string {
	return sample.at
}

const SPEC: StampRecordSpec<Sample> = {
	parse: parse_sample,
	timestamp_of: at_of,
	max_age_ms: MAX_AGE_MS,
}

function raw_at(at: string): string {
	return JSON.stringify({ at })
}

describe('stamp_record.is_older_than — the one expiry every aged record shares', () => {
	it('reads a time that is not a date as older than any bound', () => {
		expect(stamp_record.is_older_than('not a date', MAX_AGE_MS, NOW)).toBe(true)
		expect(stamp_record.is_older_than('', MAX_AGE_MS, NOW)).toBe(true)
	})

	it('keeps a record exactly at the bound current', () => {
		expect(stamp_record.is_older_than(AT_BOUND, MAX_AGE_MS, NOW)).toBe(false)
	})

	it('expires a record one millisecond past the bound', () => {
		expect(stamp_record.is_older_than(PAST_BOUND, MAX_AGE_MS, NOW)).toBe(true)
	})

	it('keeps a time ahead of now current', () => {
		expect(stamp_record.is_older_than(AHEAD_OF_NOW, MAX_AGE_MS, NOW)).toBe(false)
	})

	it('keeps a record written at now current under a zero bound', () => {
		expect(stamp_record.is_older_than(NOW.toISOString(), 0, NOW)).toBe(false)
	})
})

describe('stamp_record.classify — none, unreadable, expired or carried', () => {
	it('answers none for an absent record', () => {
		expect(stamp_record.classify(undefined, SPEC, NOW)).toEqual({ kind: 'none' })
	})

	it('answers unreadable for text that is not JSON', () => {
		expect(stamp_record.classify('{', SPEC, NOW)).toEqual({ kind: 'unreadable' })
	})

	it('answers unreadable for JSON the parser rejects', () => {
		expect(stamp_record.classify('{"at":1}', SPEC, NOW)).toEqual({ kind: 'unreadable' })
	})

	it('carries a record inside the bound, with the record', () => {
		expect(stamp_record.classify(raw_at(AT_BOUND), SPEC, NOW)).toEqual({
			kind: 'carried',
			record: { at: AT_BOUND },
		})
	})

	it('expires a record past the bound, with the record', () => {
		expect(stamp_record.classify(raw_at(PAST_BOUND), SPEC, NOW)).toEqual({
			kind: 'expired',
			record: { at: PAST_BOUND },
		})
	})

	it('expires a record whose time is not a date', () => {
		expect(stamp_record.classify(raw_at('never'), SPEC, NOW).kind).toBe('expired')
	})

	it('carries a record whose time is ahead of now', () => {
		expect(stamp_record.classify(raw_at(AHEAD_OF_NOW), SPEC, NOW).kind).toBe('carried')
	})
})
