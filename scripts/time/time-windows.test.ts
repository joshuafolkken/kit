import { describe, expect, it } from 'vitest'
import { time_format } from './time-format'
import { time_windows, type RunWindows } from './time-windows'

// joshuafolkken/kit#1409: one run is three nested windows, and a window nobody could read has to be
// distinguishable from one that measured zero. The suite is about the type and its rendering alone —
// where the three windows come from is `time-run.test.ts`'s.

const MINUTE_MS = 60_000
const RUN_START_MS = Date.UTC(2026, 8, 8, 6, 52, 19)
const RUN_END_MS = RUN_START_MS + 20 * MINUTE_MS
const PULL_START_MS = RUN_START_MS + 11 * MINUTE_MS
const PULL_END_MS = PULL_START_MS + 8 * MINUTE_MS

function rendered(windows: RunWindows): string {
	return time_windows.window_lines(windows).join('\n')
}

function row_of(windows: RunWindows, label: string): string {
	return time_windows.window_lines(windows).find((line) => line.trimStart().startsWith(label)) ?? ''
}

describe('time_windows.build_window', () => {
	it('reads a window with both ends and carries its length', () => {
		const window = time_windows.build_window(RUN_START_MS, RUN_END_MS)

		expect(window.is_read).toBe(true)
		expect(window.elapsed_ms).toBe(20 * MINUTE_MS)
		expect(window.started_at).toBe(new Date(RUN_START_MS).toISOString())
		expect(window.ended_at).toBe(new Date(RUN_END_MS).toISOString())
	})

	it('withholds a window whose end was never reached', () => {
		expect(time_windows.build_window(RUN_START_MS, undefined)).toEqual(time_windows.UNREAD_WINDOW)
	})

	it('withholds a window neither end of which was read', () => {
		expect(time_windows.build_window(0, 0).is_read).toBe(false)
	})

	it('keeps a measured zero-length window read', () => {
		const window = time_windows.build_window(RUN_START_MS, RUN_START_MS)

		expect(window.is_read).toBe(true)
		expect(window.elapsed_ms).toBe(0)
	})
})

describe('time_windows.window_lines', () => {
	it('prints all three windows under one heading', () => {
		const text = rendered(time_windows.NO_WINDOWS)

		expect(text).toContain(time_windows.HEADING)
		expect(text).toContain(time_windows.RUN_LABEL)
		expect(text).toContain(time_windows.PULL_LABEL)
		expect(text).toContain(time_windows.ISSUE_LABEL)
	})

	it('says a window was not measured rather than totalling zero', () => {
		const row = row_of(time_windows.NO_WINDOWS, time_windows.PULL_LABEL)

		expect(row).toContain(time_format.NOT_MEASURED)
		expect(row).not.toContain('0.0 min')
	})

	it('prints a measured zero-length window as a duration, not as unmeasured', () => {
		const zero = time_windows.build_window(RUN_START_MS, RUN_START_MS)
		const row = row_of({ ...time_windows.NO_WINDOWS, run: zero }, time_windows.RUN_LABEL)

		expect(row).toContain('0.0 min')
		expect(row).not.toContain(time_format.NOT_MEASURED)
	})
})

describe('time_windows.window_lines — one window at a time', () => {
	it('withholds each window on its own', () => {
		const windows = {
			run: time_windows.build_window(RUN_START_MS, RUN_END_MS),
			pull: time_windows.build_window(PULL_START_MS, PULL_END_MS),
			issue: time_windows.UNREAD_WINDOW,
		}

		expect(row_of(windows, time_windows.RUN_LABEL)).toContain('20.0 min')
		expect(row_of(windows, time_windows.PULL_LABEL)).toContain('8.0 min')
		expect(row_of(windows, time_windows.ISSUE_LABEL)).toContain(time_format.NOT_MEASURED)
	})

	it('names the clock a read window ran between', () => {
		const run = time_windows.build_window(RUN_START_MS, RUN_END_MS)
		const windows = { ...time_windows.NO_WINDOWS, run }

		expect(row_of(windows, time_windows.RUN_LABEL)).toContain(
			time_format.format_window(RUN_START_MS, RUN_END_MS),
		)
	})
})
