import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_notice } from './run-board-theme-deviant-notice'
import { run_board_theme_deviant_parts } from './run-board-theme-deviant-parts'
import { run_board_theme_deviant_wall } from './run-board-theme-deviant-wall'
import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Area, Cell, Grid } from './run-board-theme-host-types'

// The deviant theme's NOTICE in the header's borrowed blocks, never over the notice's or the
// progress line's text. Left: the order stamped in two weights and its two choices, IGNORE over
// OBEY, each in its bracketed box — the cursor plate on OBEY fades up to IGNORE and pulses once,
// before the wall starts. First row: the machine gauges as red bars that step up at each hit. Pinned
// column: the probability, falling in red, then rising in cyan from the peak. The blocks give way to the board again before the notice ends.

const { repeated } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { PEAK_TICKS } = run_board_theme_host_state
const { PAIR, clamped, clear_pane, put_in, share_of } = run_board_theme_draw
const { RGB, WALL } = run_board_theme_deviant_data
const { GAUGES, HEAD, ODDS, ORDER, PROMPT } = run_board_theme_deviant_notice
const { bold, duo, ink, mix, on } = run_board_theme_deviant_parts
const { glitched, hits_passed } = run_board_theme_deviant_wall

// The header's rows as they were before the blocks were taken.
type Kept = Array<Array<Cell>>

function block_pane(grid: Grid, area: Area, rows: number): Pane {
	return { grid, box: { x: area.x, y: 0, w: area.w, h: rows } }
}

// The blocks hold the notice's parts until they have given way to the board.
function is_shown(age: number): boolean {
	return age - PEAK_TICKS < HEAD.fade_from + HEAD.fade_ticks
}

function is_walled(age: number): boolean {
	return age >= WALL.from
}

// The blocks the notice takes emptied: the left one from its start, the first row's gauges and the
// pinned column once the wall starts.
function clear_blocks(draw: ThemeDraw, age: number): void {
	const { api, grid } = draw
	const { head_left, head_right, head_top } = api.layout

	if (!is_shown(age)) return
	clear_pane(block_pane(grid, head_left, WALL.header_rows))
	if (!is_walled(age)) return
	clear_pane(block_pane(grid, head_right, WALL.header_rows))
	clear_pane(block_pane(grid, head_top, 1))
}

// The header's rows as they are, kept; then the notice's blocks emptied.
function open(draw: ThemeDraw, age: number): Kept {
	const kept = draw.grid.slice(0, WALL.header_rows).map((row) => [...row])

	clear_blocks(draw, age)

	return kept
}

// A word of the header, glitching as the order does while the wall builds.
function word_of(text: string, draw: ThemeDraw, age: number, seed: number): string {
	return is_walled(age) && age < PEAK_TICKS ? glitched(text, draw.tick, seed) : text
}

// The choices' lines, top to bottom: the one the cursor moves up to, and the one it starts on.
const TAKEN = 0
const FIRST = 1

// How lit a choice's plate is: on OBEY, the lower line, while it holds, fading up to IGNORE.
function choice_share(index: number, age: number): number {
	const over = share_of(age, PROMPT.hold, PROMPT.fade)

	return index === FIRST ? Math.min(share_of(age, PROMPT.list_after, PROMPT.fade), 1 - over) : over
}

// The taken choice's plate pulses blue once as the cursor lands on it.
function plate_ground(index: number, age: number): string {
	const since = age - PROMPT.pulse_from

	return index === TAKEN && since >= 0 && since < PROMPT.pulse_ticks ? RGB.blue : RGB.steel
}

// A choice in its own small box: a corner bracket at each end — dim until the cursor is on it — its
// label and symbol on the cursor's plate, and a small `+` past the upper box's corner.
function choice(pane: Pane, index: number, age: number, label: string): void {
	const share = choice_share(index, age)
	const y = index + 1
	const corner = ink(mix(RGB.plate, RGB.soft, share))
	const ground = mix(RGB.night, plate_ground(index, age), share)
	const end = PROMPT.x + PROMPT.label_w + PAIR
	const text = ` ${label.padEnd(PROMPT.label_w)} `

	put_in(pane, { x: PROMPT.x - 1, y }, '⌜', corner)
	put_in(pane, { x: PROMPT.x, y }, text, share > 0 ? on(RGB.white, ground) : ink(RGB.soft))
	put_in(pane, { x: end, y }, '⌟', corner)
	if (index === TAKEN) put_in(pane, { x: end + 1, y }, '+', ink(RGB.plate))
}

// The left block: the order in two weights, then its two choices under it, IGNORE over OBEY.
function order_prompt(draw: ThemeDraw, age: number): void {
	const pane = block_pane(draw.grid, draw.api.layout.head_left, WALL.header_rows)
	const shown = age * PROMPT.pace
	const word = word_of(ORDER.word, draw, age, PROMPT.order_seed).slice(0, shown)
	const tail = ORDER.tail.slice(0, Math.max(0, shown - ORDER.tail_x))

	duo(pane, { x: PROMPT.x, y: 0 }, [word, tail], RGB.order)
	if (age < PROMPT.list_after) return
	choice(pane, TAKEN, age, word_of(PROMPT.ignore, draw, age, PROMPT.ignore_seed))
	choice(pane, FIRST, age, word_of(PROMPT.obey, draw, age, PROMPT.obey_seed))
}

// How full gauge `index` is: a step up at each hit, easing back down after the peak.
function gauge_level(index: number, age: number): number {
	const hits = hits_passed(age - WALL.from)
	const level = GAUGES.base + GAUGES.step * hits + GAUGES.sway * hash(index, GAUGES.salt)

	return clamped(level) * (1 - share_of(age, PEAK_TICKS, HEAD.fade_from))
}

function gauge(pane: Pane, index: number, draw: ThemeDraw, age: number): void {
	const segment = Math.floor(pane.box.w / GAUGES.words.length)
	const x = index * segment + GAUGES.label_w
	const width = Math.max(0, segment - GAUGES.label_w - GAUGES.gap)
	const lit = Math.round(gauge_level(index, age) * width)
	const [bright, track] = age < PEAK_TICKS ? [RGB.red, RGB.track] : [RGB.blue, RGB.plate]
	const label = word_of(GAUGES.words[index] ?? '', draw, age, GAUGES.seed + index)

	put_in(pane, { x: index * segment, y: 0 }, label, bold(RGB.soft))
	put_in(pane, { x, y: 0 }, repeated('━', lit), bold(bright))
	put_in(pane, { x: x + lit, y: 0 }, repeated('━', width - lit), ink(track))
}

// The probability: falling through the wall's build, rising from the peak.
function odds_of(age: number): number {
	if (age < PEAK_TICKS) {
		return ODDS.start - Math.round(share_of(age, WALL.from, WALL.build) * ODDS.fall)
	}

	return ODDS.low + Math.round(share_of(age, PEAK_TICKS, ODDS.rise_ticks) * ODDS.rise)
}

// The readout's chevron, color and status word: falling through the build, rising from the peak.
const FALLING = ['∨', RGB.red, ODDS.falling] as const
const RISING = ['∧', RGB.cyan, ODDS.rising] as const

// The readout as the source lays it out, in a column wide enough for it: the label in two small
// lines at the number's right, the status line under them. The thin rule over it has no row here.
function wide_readout(pane: Pane, note: string, color: string): void {
	put_in(pane, { x: ODDS.label_x, y: 0 }, ODDS.label, ink(RGB.soft))
	put_in(pane, { x: ODDS.label_x, y: 1 }, ODDS.sub, ink(RGB.soft))
	duo(pane, { x: 1, y: PAIR }, [ODDS.who, note], color)
}

// The chevron and the number; then the source's layout, or in a narrow column the label's two lines
// under the number — the panel's status page carries the status line through a NOTICE.
function readout(pane: Pane, age: number): void {
	const [chevron, color, note] = age < PEAK_TICKS ? FALLING : RISING

	put_in(pane, { x: 1, y: 0 }, `${chevron} ${String(odds_of(age))}%`, bold(color))

	if (pane.box.w > ODDS.label_x + ODDS.label.length) {
		wide_readout(pane, note, color)

		return
	}

	put_in(pane, { x: 1, y: 1 }, ODDS.label, ink(RGB.soft))
	put_in(pane, { x: 1, y: PAIR }, ODDS.sub, ink(RGB.soft))
}

function restore_column(grid: Grid, kept: Kept, x: number, rows: number): void {
	for (let y = 0; y < rows; y++) {
		const cell = kept[y]?.[x]
		const row = grid[y]

		if (cell && row) row[x] = cell
	}
}

// The board's own header back in the blocks, a pair of columns at a time, `ease` of the way.
function restore(draw: ThemeDraw, kept: Kept, ease: number): void {
	const { head_left, head_right, head_top } = draw.api.layout
	const blocks = [
		{ ...head_left, rows: WALL.header_rows },
		{ ...head_right, rows: WALL.header_rows },
		{ ...head_top, rows: 1 },
	]

	for (const block of blocks) {
		const columns = Array.from({ length: block.w }, (_, index) => block.x + index)
		const back = columns.filter((x) => hash(Math.floor(x / PAIR), HEAD.salt) < ease)

		for (const x of back) restore_column(draw.grid, kept, x, block.rows)
	}
}

// The notice's parts in the blocks, drawn over whatever the wall laid there.
function close(draw: ThemeDraw, age: number, kept: Kept): void {
	const { api, grid } = draw
	const { head_right, head_top } = api.layout

	if (!is_shown(age)) return
	order_prompt(draw, age)

	if (is_walled(age)) {
		for (const index of GAUGES.words.keys()) gauge(block_pane(grid, head_top, 1), index, draw, age)

		readout(block_pane(grid, head_right, WALL.header_rows), age)
	}

	restore(draw, kept, share_of(age, PEAK_TICKS + HEAD.fade_from, HEAD.fade_ticks))
}

const run_board_theme_deviant_header = { choice_share, close, odds_of, open }

export { run_board_theme_deviant_header }
