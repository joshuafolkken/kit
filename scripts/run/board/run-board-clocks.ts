import { run_board_labels } from './run-board-labels'
import type { Theme } from './run-board-theme-defs'

// The header's clock column (`run-board-header.ts`, joshuafolkken/kit#8478): when the run should finish
// over the time now over when it started. An ended run's finish is when it ended; a finish not known —
// no plan read, a stopped run, nothing measured — is `--:--`. The clocks take no color of their own, so
// a theme draws them in its own. All three carry their `MM-DD` once one falls on another day than the
// others, so the rows stay one width and a finish tomorrow never reads as one past.

const { HEADER_ICONS, day_minute_of, minute_of } = run_board_labels
const NOW_ICON = '🕒'
const START_ICON = '🚀'
// A themed screen draws the start as the launch's T-zero beside the lanes rule's `T+`: its glyph table
// keeps 🚀 as the starting stage's `GO`.
const THEMED_START = 'T0'
const UNKNOWN_TIME = '--:--'

// What the clocks read off the header (`BoardHeader`).
interface ClockHeader {
	now_ms: number
	started_ms: number
	ended_ms: number | undefined
	theme?: Theme | undefined
	form: 'screen' | 'chat'
}

function is_one_day(times: ReadonlyArray<number>): boolean {
	return new Set(times.map((ms) => new Date(ms).toDateString())).size <= 1
}

function start_icon(header: ClockHeader): string {
	return header.theme !== undefined && header.form === 'screen' ? THEMED_START : START_ICON
}

// The finish (`finish_ms`, `undefined` where none is estimated), now and the start, each after its icon.
function clocks_of(header: ClockHeader, finish_ms: number | undefined): Array<string> {
	const times = [header.ended_ms ?? finish_ms, header.now_ms, header.started_ms]
	const format = is_one_day(times.filter((ms) => ms !== undefined)) ? minute_of : day_minute_of
	const width = format(header.now_ms).length
	const icons = [HEADER_ICONS.estimate, NOW_ICON, start_icon(header)]

	return icons.map((icon, row) => {
		const ms = times[row]

		return `${icon} ${ms === undefined ? UNKNOWN_TIME.padStart(width) : format(ms)}`
	})
}

const run_board_clocks = { clocks_of }

export { run_board_clocks }
export type { ClockHeader }
