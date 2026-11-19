import { describe, expect, it } from 'vitest'
import { run_observe_state, type ObserveRecord } from './run-observe-state'

// joshuafolkken/kit#8128: the observation record round-trips through an Issue comment.

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const HALF_HOUR_MS = 30 * MINUTE_MS
const TWO_HOURS_MS = 2 * HOUR_MS
const STARTED_AT = '2026-11-19T05:00:00.000Z'

const RECORD: ObserveRecord = {
	command: 'pnpm josh run:board',
	sample: 'ps -o rss= -p "$OBSERVE_PID"',
	offsets_ms: [HALF_HOUR_MS, TWO_HOURS_MS],
	pid: 4242,
	process_start: 'Thu Nov 19 05:00:00 2026',
	started_at: STARTED_AT,
	samples: [],
	retakes: 0,
}

describe('run_observe_state.offset_ms', () => {
	it.each([
		['30m', HALF_HOUR_MS],
		['2h', TWO_HOURS_MS],
	])('reads %s', (text, expected) => {
		expect(run_observe_state.offset_ms(text)).toBe(expected)
	})

	it.each(['0m', '30', '1d', 'm', '-1h', ''])('refuses %j', (text) => {
		expect(run_observe_state.offset_ms(text)).toBeUndefined()
	})
})

describe('run_observe_state.comment_of — round trip', () => {
	it('reads back the record a comment carries, with its samples listed for a person', () => {
		const sampled = { ...RECORD, samples: [{ at: STARTED_AT, value: '123456' }] }
		const comment = run_observe_state.comment_of(sampled, 'sample 1')

		expect(run_observe_state.record_of(comment)).toEqual(sampled)
		expect(comment).toContain('`123456`')
		expect(comment).toContain('## Observation: sample 1')
	})

	it('reads no record from a comment without the marker or with a broken one', () => {
		expect(run_observe_state.record_of('plain comment')).toBeUndefined()
		expect(run_observe_state.record_of('<!-- josh:observe {"pid": "x"} -->')).toBeUndefined()
		expect(run_observe_state.record_of('<!-- josh:observe {not json} -->')).toBeUndefined()
	})

	it('takes the newest marked comment as the state', () => {
		const older = run_observe_state.comment_of(RECORD, 'started')
		const newer = run_observe_state.comment_of({ ...RECORD, retakes: 1 }, 'retaken')

		expect(run_observe_state.latest([older, newer, 'unrelated'])?.retakes).toBe(1)
		expect(run_observe_state.latest(['unrelated'])).toBeUndefined()
	})
})

describe('run_observe_state.next_at_ms', () => {
	it('is the launch time plus the offset of the next sample', () => {
		expect(run_observe_state.next_at_ms(RECORD)).toBe(Date.parse(STARTED_AT) + HALF_HOUR_MS)

		const sampled = { ...RECORD, samples: [{ at: STARTED_AT, value: '1' }] }

		expect(run_observe_state.next_at_ms(sampled)).toBe(Date.parse(STARTED_AT) + TWO_HOURS_MS)
	})

	it('is undefined once every sample is taken', () => {
		const samples = [
			{ at: STARTED_AT, value: '1' },
			{ at: STARTED_AT, value: '2' },
		]

		expect(run_observe_state.next_at_ms({ ...RECORD, samples })).toBeUndefined()
	})

	it('allows one retake', () => {
		expect(run_observe_state.can_retake(RECORD)).toBe(true)
		expect(run_observe_state.can_retake({ ...RECORD, retakes: 1 })).toBe(false)
	})
})
