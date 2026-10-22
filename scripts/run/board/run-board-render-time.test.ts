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

	it('has no time for a row with no start, or a settled one with no end', () => {
		expect(time_of(row('waiting'), NOW)).toBeUndefined()
		expect(time_of(row('merged', { started_ms: STARTED }), NOW)).toBeUndefined()
	})
})

describe('run_board_render_time.time_width', () => {
	it('is the widest time among the run’s own rows', () => {
		const active = [
			row('running', { started_ms: NOW - MINUTE }),
			row('merged', { started_ms: STARTED, ended_ms: STARTED + HOUR }),
			row('parked'),
		]

		expect(time_width(header({ layout: { ...EMPTY_LAYOUT, active } }))).toBe('1°00′00″'.length)
	})

	it('is zero with no layout or no timed row', () => {
		expect(time_width(header({ layout: undefined }))).toBe(0)
		expect(time_width(header())).toBe(0)
	})
})
