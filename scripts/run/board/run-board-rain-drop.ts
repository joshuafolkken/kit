import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_drop_screen, type DropScreen, type ScreenPlace } from './run-board-drop-screen'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_idle_rain } from './run-board-idle-rain'
import { run_board_labels, type Paint } from './run-board-labels'
import { run_board_lamps } from './run-board-lamps'
import { run_board_rain } from './run-board-rain'
import { run_board_rain_gradient } from './run-board-rain-gradient'
import { run_board_rain_pour } from './run-board-rain-pour'
import { run_board_sweep } from './run-board-sweep'
import type { TypingSpan } from './run-board-type-rows'

// joshuafolkken/kit#8367: the matrix board's drop, in place of the wargames sweep. On every second one
// drop enters the top row in a column drawn at random and falls down the whole board at the idle rain
// panel's pace (`run_board_idle_rain.pace_of`), a step every `DROP_MS`, until its trail falls past the
// frame's last row on screen. A blank cell it passes shows code; a cell with text keeps its character,
// white at the head and bright for the two cells behind it, so a drop never hides what the board says.
// Each drop is read off the clock and the step it entered on, so a turn writes only the cells that
// changed since the last one.
// joshuafolkken/kit#8369: while a row types the rain pours — `POUR_PER_STEP` drops enter on each step in
// place of the second's one, each at its own pace in the pour's spread, and every drop falling speeds
// up to at least the pour's floor (`POUR_FLOOR`). From the step the typing ends the second's drop returns.
// joshuafolkken/kit#8627: every drop's trail runs 40% to 100% of the screen's rows, the rain's gradient
// over it (`run_board_rain_gradient`, joshuafolkken/kit#8742). The pour falls twice the panel's pour (`POUR_GAIN`), on
// the drops only, and once the typing ends a poured drop gains its own pace again each second.
// joshuafolkken/kit#8629: a deja vu pours too (`DEJA_BURST`), its drops painting over the text.

const { SHADES } = run_board_header_trace
const { cell_at, is_kept, key_of } = run_board_drop_screen
const { POUR } = run_board_idle_rain
const DROP_MS = run_board_sweep.SWEEP_MS
const POUR_PER_STEP = 4
const POUR_GAIN = 2
const POUR_FLOOR = POUR.least * POUR_GAIN
const FILM = { least: 0.4, spread: 0.6 }
const LIT_TRAIL = 2
const SALT = { column: 1, speed: 2, glyph: 3, trail: 6 }
const SCALE = 1000
const PAIR = 2
const CSI = '\u{1B}['
const { RESET } = run_board_cut_styled

// A number in `0`..`1` drawn for the values, the same for the same ones: the drop's random source.
type Share = (values: ReadonlyArray<number>) => number

interface Fall {
	born_ms: number
	column: number
	speed: number
	// The cells of the trail behind the head.
	length: number
	// A poured drop's typing end, from which it hurries; none for the second's drop.
	ends_ms?: number
	// A deja vu's drop, which paints over the board's text rather than lighting it.
	covers?: true | undefined
}

// A rain that pours drops in on each step of its spans: the screen's spans it reads, the drops a step and
// the salts their column, pace and trail are drawn with.
interface Burst {
	spans: 'pours' | 'deja_spans'
	per_step: number
	salts: { column: number; speed: number; trail: number }
	covers?: true
}

// joshuafolkken/kit#8629: a deja vu rains `DEJA_STEPS` steps from its first frame, six drops a step at
// the pour's pace, over the board's text, hurrying once its last drop is in.
const POUR_BURST: Burst = {
	spans: 'pours',
	per_step: POUR_PER_STEP,
	salts: { column: 4, speed: 5, trail: 7 },
}
const DEJA_BURST: Burst = {
	spans: 'deja_spans',
	per_step: 6,
	salts: { column: 8, speed: 9, trail: 10 },
	covers: true,
}
const DEJA_STEPS = 20

// The step a poured drop entered on, the end of the span that poured it and the rain it is in.
interface PourStep {
	born_ms: number
	ends_ms: number
	burst: Burst
}

function mixed_share(values: ReadonlyArray<number>): number {
	return (run_board_lamps.mixed(values) % SCALE) / SCALE
}

function column_of(fraction: number, columns: number): number {
	return 1 + Math.min(columns - 1, Math.floor(fraction * columns))
}

// A trail `fraction` of the way from 40% to 100% of the screen's `rows`.
function trail_of(rows: number, fraction: number): number {
	return Math.round(rows * (FILM.least + fraction * FILM.spread))
}

// The drop that entered on the second `born_ms`: its column, its pace and its trail.
function fall_of(born_ms: number, screen: DropScreen, share: Share): Fall {
	const column = column_of(share([born_ms, SALT.column]), screen.columns)
	const speed = run_board_idle_rain.pace_of(share([born_ms, SALT.speed]))

	return {
		born_ms,
		column,
		speed,
		length: trail_of(screen.rows.length, share([born_ms, SALT.trail])),
	}
}

// The `nth` drop the rain poured in on `step`: its column, its pace in twice the pour's spread and its
// trail.
function poured_fall(step: PourStep, nth: number, screen: DropScreen, share: Share): Fall {
	const { born_ms, ends_ms, burst } = step
	const { salts } = burst
	const column = column_of(share([born_ms, salts.column, nth]), screen.columns)
	const speed = (POUR.least + share([born_ms, salts.speed, nth]) * POUR.spread) * POUR_GAIN
	const length = trail_of(screen.rows.length, share([born_ms, salts.trail, nth]))

	return { born_ms, ends_ms, column, speed, length, covers: burst.covers }
}

function steps_of(fall: Fall, at_ms: number): number {
	return Math.floor((at_ms - fall.born_ms) / DROP_MS)
}

// `0 + 1 + … + (count - 1)`.
function triangular(count: number): number {
	return (count * (count - 1)) / PAIR
}

// The rows a poured drop falls in its first `steps` past its own pace: on each step starting from its
// typing's end on, its pace once more for each second since the end.
function hurried_rows(fall: Fall, steps: number): number {
	if (fall.ends_ms === undefined) return 0
	const first = Math.max(0, Math.ceil((fall.ends_ms - fall.born_ms) / DROP_MS))
	const count = Math.max(0, steps - first)
	const lead_ms = fall.born_ms + first * DROP_MS - fall.ends_ms

	return (fall.speed * (count * lead_ms + triangular(count) * DROP_MS)) / MS_PER_SECOND
}

// The screen row the drop's head is on: the top row on the step it enters, falling at least the pour's
// pace on each step the rain pours, and a poured drop hurrying once its typing ends.
function head_row(fall: Fall, at_ms: number, pours: ReadonlyArray<TypingSpan> = []): number {
	const steps = steps_of(fall, at_ms)
	const sped = run_board_rain_pour.poured_steps(pours, fall.born_ms, fall.born_ms + steps * DROP_MS)
	const fallen = (steps - sped) * fall.speed + sped * Math.max(fall.speed, POUR_FLOOR)

	return 1 + Math.floor(fallen + hurried_rows(fall, steps))
}

// How far back a drop at `pace` can have entered and still have its trail, the longest one the screen
// draws, on the frame's last row. A hurried drop only leaves sooner.
function reach_ms(screen: DropScreen, pace: number): number {
	return Math.ceil((screen.rows.length + trail_of(screen.rows.length, 1)) / pace) * DROP_MS
}

// One drop entered on each second the rain does not pour, back as far as the slowest could still be on
// screen.
function second_falls(screen: DropScreen, at_ms: number, share: Share): Array<Fall> {
	const reach = reach_ms(screen, run_board_idle_rain.pace_of(0))
	const last = Math.floor(at_ms / MS_PER_SECOND)
	const first = Math.max(0, Math.floor((at_ms - reach) / MS_PER_SECOND))
	const seconds = Array.from({ length: last - first + 1 }, (_second, index) => first + index)

	return seconds
		.map((second) => fall_of(second * MS_PER_SECOND, screen, share))
		.filter((fall) => !run_board_rain_pour.is_pouring(screen.pours ?? [], fall.born_ms))
}

// The burst's drops entered on each step up to `at_ms` of its spans, back as far as the slowest could
// still be on screen, each hurrying from the end of its span.
function poured_falls(screen: DropScreen, at_ms: number, share: Share, burst: Burst): Array<Fall> {
	const from_ms = at_ms - reach_ms(screen, POUR_FLOOR)
	const past_ms = (Math.floor(at_ms / DROP_MS) + 1) * DROP_MS

	return (screen[burst.spans] ?? []).flatMap((span) =>
		run_board_rain_pour
			.pour_steps([span], from_ms, past_ms)
			.flatMap((born_ms) =>
				Array.from({ length: burst.per_step }, (_drop, nth) =>
					poured_fall({ born_ms, ends_ms: span.to_ms, burst }, nth, screen, share),
				),
			),
	)
}

// The drops on the screen at `at_ms`: the seconds', the pour's and, drawn over them, the deja vu's.
function falls_at(screen: DropScreen, at_ms: number, share: Share): Array<Fall> {
	const falls = [
		...second_falls(screen, at_ms, share),
		...poured_falls(screen, at_ms, share, POUR_BURST),
		...poured_falls(screen, at_ms, share, DEJA_BURST),
	]

	return falls.filter(
		(fall) => head_row(fall, at_ms, screen.pours) - fall.length <= screen.rows.length,
	)
}

// A blank cell under the drop: a fresh glyph in the two lead cells every step, a settled one in the
// trail, which never rerolls.
function code_glyph(fall: Fall, place: ScreenPlace, index: number, at_ms: number): string {
	if (run_board_rain_gradient.is_flicker(index)) {
		const step = steps_of(fall, at_ms)

		return run_board_rain.fresh(() =>
			mixed_share([fall.born_ms, step, SALT.glyph, fall.column, index]),
		)
	}

	return run_board_rain.settled({ x: place.column, y: place.row }, run_board_idle_rain.never)
}

// The paint of the drop's `index`th cell (0 the head), the rain's gradient over its trail.
function paint_at(fall: Fall, index: number): Paint {
	return run_board_rain_gradient.paint_at(index, fall.length) ?? SHADES.darkest
}

// What the drop draws in its `index`th cell (0 the head): its painted `code` in a blank, the cell's own
// character lit in one with text, or nothing where the cell keeps its own colors.
function lit_text(
	screen: DropScreen,
	place: ScreenPlace,
	index: number,
	code: () => string,
): string | undefined {
	const { text } = cell_at(screen, place)

	if (text === ' ') return code()
	if (index === 0) return run_board_labels.painted(SHADES.head, text)

	return index <= LIT_TRAIL ? run_board_labels.painted(SHADES.bright, text) : undefined
}

// What the drop draws in its `index`th cell: a covering drop its painted code over any cell, any other
// what `lit_text` draws.
function drawn_text(
	screen: DropScreen,
	moment: { fall: Fall; at_ms: number },
	place: ScreenPlace,
	index: number,
): string | undefined {
	const { fall, at_ms } = moment

	function code(): string {
		return run_board_labels.painted(paint_at(fall, index), code_glyph(fall, place, index, at_ms))
	}

	return fall.covers === true ? code() : lit_text(screen, place, index, code)
}

// The drop's cells on the screen at `at_ms`, each as written, by `row;column`.
function fall_cells(screen: DropScreen, fall: Fall, at_ms: number): Array<[string, string]> {
	const head = head_row(fall, at_ms, screen.pours)

	return Array.from({ length: fall.length + 1 }, (_cell, index) => ({
		row: head - index,
		column: fall.column,
	})).flatMap((place, index) => {
		if (place.row < 1 || place.row > screen.rows.length || is_kept(screen, place)) return []
		const text = drawn_text(screen, { fall, at_ms }, place, index)

		return text === undefined ? [] : [[key_of(place), text]]
	})
}

function lit_cells(screen: DropScreen, at_ms: number, share: Share): Map<string, string> {
	return new Map(falls_at(screen, at_ms, share).flatMap((fall) => fall_cells(screen, fall, at_ms)))
}

// The cell at `row;column` put back as the frame drew it.
function restored(screen: DropScreen, key: string): string {
	const [row = 0, column = 0] = key.split(';').map(Number)
	const cell = cell_at(screen, { row, column })

	return `${CSI}${key}H${RESET}${cell.style}${cell.text}${RESET}`
}

// The drops moved from `since_ms` to `at_ms`: the cells they left put back, the cells they lit written —
// every one where there is no `since_ms`.
function drop_bytes(
	screen: DropScreen | undefined,
	at_ms: number,
	since_ms: number | undefined,
	share: Share = mixed_share,
): string {
	if (screen === undefined) return ''
	const now = lit_cells(screen, at_ms, share)
	const before =
		since_ms === undefined ? new Map<string, string>() : lit_cells(screen, since_ms, share)
	const left = [...before.keys()].filter((key) => !now.has(key)).map((key) => restored(screen, key))
	const lit = [...now]
		.filter(([key, text]) => before.get(key) !== text)
		.map(([key, text]) => `${CSI}${key}H${RESET}${text}`)

	return [...left, ...lit].join('')
}

// The span a deja vu rains over from its first frame.
function deja_span(from_ms: number): TypingSpan {
	return { from_ms, to_ms: from_ms + DEJA_STEPS * DROP_MS }
}

// The screen with the spans the rain pours over: this frame's rows typing and the last frame's spans a
// drop they sped up can still be on screen for, merged — and, merged apart, the deja vus' rains
// (`deja_spans`, each from `deja_span`) still on screen, so two deja vus rain once on their shared steps.
function poured(
	screen: DropScreen,
	spans: ReadonlyArray<TypingSpan>,
	now_ms: number,
	deja_spans: ReadonlyArray<TypingSpan> = [],
): DropScreen {
	const since_ms = now_ms - reach_ms(screen, run_board_idle_rain.pace_of(0))
	const { merged } = run_board_rain_pour

	function on_screen(span: TypingSpan): boolean {
		return span.to_ms > since_ms
	}

	return {
		...screen,
		pours: merged(spans.filter((span) => on_screen(span))),
		deja_spans: merged(deja_spans.filter((span) => on_screen(span))),
	}
}

const run_board_rain_drop = {
	DEJA_STEPS,
	DROP_MS,
	deja_span,
	drop_bytes,
	falls_at,
	head_row,
	poured,
}

export { run_board_rain_drop }
export type { Fall, Share }
