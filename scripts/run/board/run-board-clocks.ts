import { figure_format } from '#scripts/lib/figure-format'
import { run_board_labels } from './run-board-labels'
import { run_board_spot } from './run-board-spot'

// The header's clock column (`run-board-header.ts`, joshuafolkken/kit#8478): when the run should finish
// over the time now over when it started. An ended run's finish is when it ended; a finish not known —
// no plan read, a stopped run, nothing measured — is `--:--`. The clocks take no color of their own, so
// a theme draws them in its own. A finish or start a day or more from now reads its `MM-DD` instead of
// its time (joshuafolkken/kit#8928), so every row stays five columns. The icons stay emoji
// here; a theme's glyph table draws them in the icons it was asked for (joshuafolkken/kit#8505).

const { HEADER_ICONS, day_minute_of, minute_of } = run_board_labels
const { day_of } = figure_format
const NOW_ICON = '🕒'
const START_ICON = '🚀'
const UNKNOWN_TIME = '--:--'
const UNKNOWN_DATED = `----- ${UNKNOWN_TIME}`
const { COLON } = run_board_spot

// What the clocks read off the header (`BoardHeader`).
interface ClockHeader {
	now_ms: number
	started_ms: number
	ended_ms: number | undefined
	form: 'screen' | 'chat'
	// Set only on a live board's terminal (`run-board-tick-draw.ts`).
	spinner?: string | undefined
}

// joshuafolkken/kit#8476: a live board's running clocks carry their colons as placeholders the spin
// blinks between redraws (`run-board-colon.ts`); an ended run's and a one-shot frame's stay lit.
function colons_of(header: ClockHeader, time: string): string {
	const is_live = header.spinner !== undefined && header.form === 'screen'
	const is_blinking = is_live && header.ended_ms === undefined

	return is_blinking ? time.split(':').join(COLON) : time
}

const DAY_MS = 86_400_000

// joshuafolkken/kit#8928: a clock reads `HH:MM`, or `MM-DD` — the same five columns — once it is a day
// or more from now. The time now is always `HH:MM`.
function clock_text(ms: number, now_ms: number): string {
	return Math.abs(ms - now_ms) >= DAY_MS ? day_of(ms) : minute_of(ms)
}

// The finish (`finish_ms`, `undefined` where none is estimated), now and the start, each after its icon.
function clocks_of(header: ClockHeader, finish_ms: number | undefined): Array<string> {
	const times = [header.ended_ms ?? finish_ms, header.now_ms, header.started_ms]
	const icons = [HEADER_ICONS.estimate, NOW_ICON, START_ICON]

	return icons.map((icon, row) => {
		const time = times[row] === undefined ? UNKNOWN_TIME : clock_text(times[row], header.now_ms)

		return `${icon} ${colons_of(header, time)}`
	})
}

// joshuafolkken/kit#8917: the same three times always dated (`MM-DD HH:MM`), with no icon and no colon
// placeholder — what a theme's own time readouts show while the header drops a shared date (the BTTF
// time circuits). An unknown finish keeps the width.
function dated_of(header: ClockHeader, finish_ms: number | undefined): Array<string> {
	const times = [header.ended_ms ?? finish_ms, header.now_ms, header.started_ms]

	return times.map((ms) => (ms === undefined ? UNKNOWN_DATED : day_minute_of(ms)))
}

const run_board_clocks = { clocks_of, dated_of }

export { run_board_clocks }
export type { ClockHeader }
