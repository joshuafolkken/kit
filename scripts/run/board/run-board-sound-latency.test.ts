import { afterEach, describe, expect, it } from 'vitest'
import { run_board_sound_latency } from './run-board-sound-latency'

const { MAX_DELAY_MS, OFFSET_ENV } = run_board_sound_latency
const REPORTED_MS = 120
const OFFSET_MS = 30
const NEGATIVE_OFFSET_MS = -200
const HUGE_REPORT_MS = 2000

afterEach(() => {
	run_board_sound_latency.report(undefined)
})

describe('run_board_sound_latency.reported_of', () => {
	it('reads the seconds of a latency line as milliseconds', () => {
		expect(run_board_sound_latency.reported_of('latency 0.12')).toBe(REPORTED_MS)
	})

	it.each(['latency abc', 'latency -1', 'hello', ''])('reads no report from %j', (line) => {
		expect(run_board_sound_latency.reported_of(line)).toBeUndefined()
	})
})

describe('run_board_sound_latency.offset_of', () => {
	it('reads the offset in whole milliseconds, negative included', () => {
		expect(run_board_sound_latency.offset_of({ [OFFSET_ENV]: '30.7' })).toBe(OFFSET_MS)
		expect(run_board_sound_latency.offset_of({ [OFFSET_ENV]: '-200' })).toBe(NEGATIVE_OFFSET_MS)
	})

	it('counts an unset or unreadable offset as none', () => {
		expect(run_board_sound_latency.offset_of({})).toBe(0)
		expect(run_board_sound_latency.offset_of({ [OFFSET_ENV]: 'soon' })).toBe(0)
	})
})

describe('run_board_sound_latency.delay_of', () => {
	it('adds the offset to the report', () => {
		expect(run_board_sound_latency.delay_of(REPORTED_MS, OFFSET_MS)).toBe(REPORTED_MS + OFFSET_MS)
	})

	it('holds the delay between none and the cap', () => {
		expect(run_board_sound_latency.delay_of(REPORTED_MS, NEGATIVE_OFFSET_MS)).toBe(0)
		expect(run_board_sound_latency.delay_of(HUGE_REPORT_MS, 0)).toBe(MAX_DELAY_MS)
	})

	it('counts no report as none, so the offset alone remains', () => {
		expect(run_board_sound_latency.delay_of(undefined, OFFSET_MS)).toBe(OFFSET_MS)
	})
})

describe('run_board_sound_latency.delay_ms', () => {
	it('is none until a resident player reports, whatever the offset', () => {
		expect(run_board_sound_latency.delay_ms({ [OFFSET_ENV]: String(OFFSET_MS) })).toBe(0)
	})

	it('is the kept report plus the offset', () => {
		run_board_sound_latency.report(REPORTED_MS)

		expect(run_board_sound_latency.delay_ms({ [OFFSET_ENV]: String(OFFSET_MS) })).toBe(
			REPORTED_MS + OFFSET_MS,
		)
	})

	it('is none again once the report is forgotten', () => {
		run_board_sound_latency.report(REPORTED_MS)
		run_board_sound_latency.report(undefined)

		expect(run_board_sound_latency.delay_ms({})).toBe(0)
	})
})
