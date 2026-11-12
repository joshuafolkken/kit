import { describe, expect, it } from 'vitest'
import { backlog_drive_fixture } from './backlog-drive-fixture'
import { backlog_offer_timing } from './backlog-offer-timing'

const NOW_MS = 1000
const INTERVAL_MS = 60_000

describe('backlog_offer_timing', () => {
	it.each([
		[undefined, undefined, undefined],
		[undefined, NOW_MS, undefined],
		[NOW_MS, undefined, NOW_MS],
		[NOW_MS, NOW_MS + 1, NOW_MS],
		[NOW_MS + 1, NOW_MS, NOW_MS],
	])('chooses the earlier dated or idle boundary (%s, %s)', (date, idle, expected) => {
		const state = { ...backlog_drive_fixture.state(), not_before_ms: date, idle_until_ms: idle }

		expect(backlog_offer_timing.deadline_of(state)).toBe(expected)
	})

	it('uses the deadline instead of the interval when one is present', () => {
		expect(backlog_offer_timing.due_ms(NOW_MS, 0, INTERVAL_MS)).toBe(NOW_MS)
		expect(backlog_offer_timing.due_ms(undefined, NOW_MS, INTERVAL_MS)).toBe(NOW_MS + INTERVAL_MS)
	})

	it.each([NOW_MS, NOW_MS - 1])(
		'falls back to the interval once the last ask reached deadline %s',
		(deadline) => {
			expect(backlog_offer_timing.due_ms(deadline, NOW_MS, INTERVAL_MS)).toBe(NOW_MS + INTERVAL_MS)
		},
	)

	it.each([
		[undefined, INTERVAL_MS],
		[NOW_MS + 1, 1],
		[NOW_MS + INTERVAL_MS + 1, INTERVAL_MS],
	])('bounds the local wait for deadline %s', (deadline, expected) => {
		expect(backlog_offer_timing.sleep_ms(deadline, INTERVAL_MS, NOW_MS)).toBe(expected)
	})

	it.each([NOW_MS, NOW_MS - 1])(
		'waits the full interval once deadline %s has passed',
		(deadline) => {
			expect(backlog_offer_timing.sleep_ms(deadline, INTERVAL_MS, NOW_MS)).toBe(INTERVAL_MS)
		},
	)
})

describe('backlog_offer_timing.interval_of', () => {
	const { CONFIG, FIRST_CHILD, state } = backlog_drive_fixture

	it.each([
		['no lane and a named issue left', [], true, CONFIG.idle_offer_ms],
		['no lane and nothing named left', [], false, CONFIG.offer_ms],
		['a lane and a named issue left', [FIRST_CHILD], true, CONFIG.offer_ms],
		['a lane and nothing named left', [FIRST_CHILD], false, CONFIG.offer_ms],
	])('asks at the matching interval with %s', (_label, in_flight, is_named_left, expected) => {
		expect(backlog_offer_timing.interval_of(state(in_flight), CONFIG, is_named_left)).toBe(expected)
	})
})
