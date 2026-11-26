import { describe, expect, it } from 'vitest'
import { run_board_theme_events, type BoardEvent } from './run-board-theme-events'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { TypingLine } from './run-board-type-rows'

const {
	PROGRESS_THROTTLE_MS,
	added,
	demo_timeline,
	end_of,
	event_of,
	is_playing_at,
	observed,
	row_key_of,
	timeline_at,
} = run_board_theme_events
const { FAR, NOTICE_END, PEAK_TICKS } = run_board_theme_host_state
const ORIGIN_MS = 1000
const LANE_KEY = 'lanes:8899'

function line(key: string, start_ms: number, text = 'abcdef'): TypingLine {
	return { key, index: 0, row: 1, text: `  ${text}`, prefix_columns: 2, start_ms }
}

function event(name: BoardEvent['name'], start: number, text = 'abcdefghij'): BoardEvent {
	return { name, start, text, key: `${name}@${String(start)}`, has_effect: true }
}

function events_of(...all: Array<BoardEvent>): ReadonlyArray<BoardEvent> {
	let events: ReadonlyArray<BoardEvent> = []

	for (const each of all) events = added(events, each, {})

	return events
}

describe('run_board_theme_events.event_of', () => {
	it('reads a notice, the now line and a lane from the typed rows, ticked from the origin', () => {
		expect(event_of(line('notice:a', ORIGIN_MS + 120), ORIGIN_MS)).toMatchObject({
			name: 'notice',
			start: 2,
			text: 'abcdef',
		})
		expect(event_of(line('now:b', ORIGIN_MS), ORIGIN_MS)?.name).toBe('progress')
		expect(event_of(line(LANE_KEY, ORIGIN_MS), ORIGIN_MS)?.name).toBe('row')
	})

	it('reads no event from any other row', () => {
		expect(event_of(line('done:8899', ORIGIN_MS), ORIGIN_MS)).toBeUndefined()
	})
})

describe('run_board_theme_events.observed', () => {
	it('adds each typing row once, however many redraws carry it', () => {
		const lines = [line('now:b', ORIGIN_MS), line('lanes:1', ORIGIN_MS + 50)]
		const once = observed([], lines, ORIGIN_MS, {})

		expect(observed(once, lines, ORIGIN_MS, {})).toHaveLength(2)
	})

	it('adds the same row again when it types again', () => {
		const first = observed([], [line('now:b', ORIGIN_MS)], ORIGIN_MS, {})

		expect(observed(first, [line('now:b', ORIGIN_MS + 5000)], ORIGIN_MS, {})).toHaveLength(2)
	})
})

describe('run_board_theme_events.added', () => {
	it('cuts a lower effect at once when a higher event comes, never to resume', () => {
		const events = events_of(event('progress', 0), event('notice', 3))
		const [progress] = timeline_at(events, 4).progress

		expect(events[0]?.cut).toBe(3)
		expect(progress?.start).toBe(-FAR)
		expect(timeline_at(events, 2).progress[0]?.start).toBe(0)
	})

	it('shows a lower event as its text alone while a higher effect plays', () => {
		const events = events_of(event('notice', 0), event('row', 5))

		expect(events[1]?.has_effect).toBe(false)
		expect(timeline_at(events, 6).row[0]).toEqual({ start: 5 - FAR, text: 'abcdefghij' })
	})

	it('restarts the same priority with its new text', () => {
		const events = events_of(event('progress', 0, 'first'), event('progress', 3, 'second'))
		const { progress } = timeline_at(events, 4)

		expect(events[1]?.has_effect).toBe(true)
		expect(progress.at(-1)).toEqual({ start: 3, text: 'second' })
	})

	it('plays every progress line while its throttle is 0', () => {
		expect(PROGRESS_THROTTLE_MS).toBe(0)
		expect(events_of(event('progress', 0), event('progress', 1)).every((e) => e.has_effect)).toBe(
			true,
		)
	})
})

describe('run_board_theme_events.end_of', () => {
	// joshuafolkken/kit#8917: a theme's `lasts` is the event's whole length in ticks, not an extra.
	it('plays a notice to its peak and its trace, or for the theme’s whole length', () => {
		const notice = event('notice', 10)

		expect(end_of(notice, {})).toBe(10 + PEAK_TICKS + NOTICE_END)
		expect(end_of(notice, { n: 40 })).toBe(50)
	})

	it('plays a progress or row effect while its text types, or for the theme’s whole length', () => {
		expect(end_of(event('row', 10, 'abc'), {})).toBe(13)
		expect(end_of(event('row', 10, 'abc'), { r: 5 })).toBe(15)
	})

	it('says an effect plays from its start to its end', () => {
		const events = events_of(event('row', 10, 'abc'))

		expect(is_playing_at(events, 9, {})).toBe(false)
		expect(is_playing_at(events, 12, {})).toBe(true)
		expect(is_playing_at(events, 13, {})).toBe(false)
	})
})

describe('run_board_theme_events.row_key_of', () => {
	it('names the lane the latest ROW typed', () => {
		const events = observed([], [line(LANE_KEY, ORIGIN_MS)], ORIGIN_MS, {})

		expect(row_key_of(events)).toBe(LANE_KEY)
		expect(row_key_of([])).toBeUndefined()
	})
})

describe('run_board_theme_events.demo_timeline', () => {
	// joshuafolkken/kit#8969: a demo key plays PROGRESS once — the first sample text alone.
	it('starts the demo event on the key press tick, a PROGRESS its first text alone', () => {
		const timeline = demo_timeline('p', 'row', 500)

		expect(timeline.progress.map(({ start }) => start)).toEqual([500])
		expect(demo_timeline('n', 'row', 500).notice[0]?.start).toBe(500)
		expect(demo_timeline('r', 'the row', 7).row[0]).toEqual({ start: 7, text: 'the row' })
	})

	it('plays nothing for idle', () => {
		expect(demo_timeline('i', 'row', 500)).toEqual({ notice: [], progress: [], row: [] })
	})
})
