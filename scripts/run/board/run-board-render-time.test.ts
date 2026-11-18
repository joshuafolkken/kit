import { describe, expect, it } from 'vitest'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_time } from './run-board-render-time'
import type { ItemState, ItemStatus } from './run-board-status'

// joshuafolkken/kit#4099: a row's time column — a running row's age, a settled one's span — and the
// width the column takes across the run's own rows.

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, header } = run_board_render_fixture
const { time_of, time_width } = run_board_render_time
const HOUR = 60 * MINUTE

function row(state: ItemState, status?: Omit<ItemStatus, 'state'>): BoardRow {
	const full = status === undefined ? undefined : { state, ...status }

	return { number: 1, title: 'Issue', kind: undefined, state, status: full, waits: [] }
}

describe('run_board_render_time.time_of', () => {
	it('times a running row from its start to now, whatever end it carries', () => {
		const running = row('running', { started_ms: NOW - MINUTE, ended_ms: NOW - HOUR })

		expect(time_of(running, NOW)).toBe('1′00″')
	})

	it('times a settled row from its start to its end', () => {
		const merged = row('merged', { started_ms: STARTED, ended_ms: STARTED + HOUR + 30 * MINUTE })

		expect(time_of(merged, NOW)).toBe('1°30′00″')
	})

	it('times a paused row up to when it was first seen paused, not to now (#4198)', () => {
		const paused = row('paused', { started_ms: NOW - HOUR, ended_ms: NOW - HOUR + MINUTE })

		expect(time_of(paused, NOW)).toBe('1′00″')
	})

	// joshuafolkken/kit#6577: a stopped lane's time stops where it stopped, as now moves on.
	it('times a stopped row up to its stop, whatever now is', () => {
		const stopped = row('stopped', { started_ms: NOW - HOUR, ended_ms: NOW - HOUR + MINUTE })

		expect(time_of(stopped, NOW)).toBe('1′00″')
		expect(time_of(stopped, NOW + HOUR)).toBe('1′00″')
	})

	it('has no time for a row with no start, or a settled one with no end', () => {
		expect(time_of(row('waiting'), NOW)).toBeUndefined()
		expect(time_of(row('merged', { started_ms: STARTED }), NOW)).toBeUndefined()
	})
})

// joshuafolkken/kit#7866: the host's stops come out of a row's time and are drawn beside it.
const SLEEP = { from_ms: NOW - 40 * MINUTE, to_ms: NOW - 10 * MINUTE }
const NET_OF_SLEEP = '30′00″ (+30′00″)'
const AN_HOUR = '1°00′00″'

describe('run_board_render_time.time_of -- the host slept inside the lane', () => {
	it('draws a running row net of the sleep, the sleep in brackets', () => {
		const running = row('running', { started_ms: NOW - HOUR, gaps: [SLEEP] })

		expect(time_of(running, NOW)).toBe(NET_OF_SLEEP)
	})

	it('draws a settled row as it drew while running (#4463)', () => {
		const running = row('running', { started_ms: NOW - HOUR, gaps: [SLEEP] })
		const merged = row('merged', {
			started_ms: NOW - HOUR,
			ended_ms: NOW,
			elapsed_ms: 30 * MINUTE,
			excluded_ms: 30 * MINUTE,
		})

		expect(time_of(merged, NOW + HOUR)).toBe(time_of(running, NOW))
	})

	it('draws a sleep outside the lane as no exclusion', () => {
		const before = { from_ms: NOW - 3 * HOUR, to_ms: NOW - 2 * HOUR }
		const running = row('running', { started_ms: NOW - HOUR, gaps: [before] })

		expect(time_of(running, NOW)).toBe(AN_HOUR)
	})
})

describe('run_board_render_time.time_of -- an ending recorded before the exclusion', () => {
	it('takes the sleep out of an ending recorded before the exclusion', () => {
		const merged = row('merged', {
			started_ms: NOW - HOUR,
			ended_ms: NOW,
			elapsed_ms: HOUR,
			gaps: [SLEEP],
		})

		expect(time_of(merged, NOW)).toBe(NET_OF_SLEEP)
	})

	it('leaves in an older ending a sleep that fell while the child was off its lane', () => {
		const launches = [
			{ from_ms: NOW - HOUR, end_ms: NOW - 45 * MINUTE },
			{ from_ms: NOW - 30 * MINUTE, end_ms: undefined },
		]
		const off_lane = { from_ms: NOW - 40 * MINUTE, to_ms: NOW - 35 * MINUTE }
		const merged = row('merged', {
			started_ms: NOW - HOUR,
			ended_ms: NOW,
			spans: launches,
			elapsed_ms: 45 * MINUTE,
			gaps: [off_lane],
		})

		expect(time_of(merged, NOW)).toBe('45′00″')
	})
})

describe('run_board_render_time.time_width', () => {
	it('is as wide as a bracketed time', () => {
		const active = [row('running', { started_ms: NOW - HOUR, gaps: [SLEEP] })]

		expect(time_width(header({ layout: { ...EMPTY_LAYOUT, active } }))).toBe(NET_OF_SLEEP.length)
	})

	it('is the widest time among the run’s own rows', () => {
		const active = [
			row('running', { started_ms: NOW - MINUTE }),
			row('merged', { started_ms: STARTED, ended_ms: STARTED + HOUR }),
			row('parked'),
		]

		expect(time_width(header({ layout: { ...EMPTY_LAYOUT, active } }))).toBe(AN_HOUR.length)
	})

	it('is zero with no layout or no timed row', () => {
		expect(time_width(header({ layout: undefined }))).toBe(0)
		expect(time_width(header())).toBe(0)
	})
})
