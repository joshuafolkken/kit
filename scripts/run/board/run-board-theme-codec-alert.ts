import type { Codec, Paint } from './run-board-theme-codec-context'
import { run_board_theme_codec_data } from './run-board-theme-codec-data'
import { run_board_theme_codec_radar } from './run-board-theme-codec-radar'
import { run_board_theme_host_fonts } from './run-board-theme-host-fonts'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid, Point, ThemeLayout, ThemeState } from './run-board-theme-host-types'

// The codec theme's alert (joshuafolkken/kit#8917), ported from the confirmed theme demo: a NOTICE
// is ALERT while it types and a second after, then EVASION, then CAUTION — each with its
// countdown; ALERT jams the radar across the area and overflows into the header, and every phase
// sends a gradient wave along the rules and the rows' first words.

const { BOLD, bg, cell_at, centered, fg, is_rule, mixed, put, repeated, restyle, set_cell } =
	run_board_theme_host_grid
const { cells_bar: gauge } = run_board_theme_host_grid
const { big_number, big_width, banner } = run_board_theme_host_fonts
const { NOTICE_END } = run_board_theme_host_state
const { LEFT_ARROW, STYLE, life_color } = run_board_theme_codec_data
const { radar } = run_board_theme_codec_radar

// An alert phase: its label and color, the wave's dim colors (bright, dark), its count and the
// rate the countdown falls by, and the share of it left.
interface Phase {
	label: string
	color: string
	dim: [string, string]
	count: number
	rate: number
	left: number
}

const ALERT_TAIL = 20
const EVASION_END = 60
const EVASION_TICKS = 40
const RATE = { alert: 0.05, after: 0.3 }
const COUNTER = { top: 99.99, places: 2, w: 5 }

function alert_phase(notice: ThemeState['notice'], tick: number): Phase {
	const count = tick - notice.start

	return {
		label: 'ALERT',
		color: '255;50;40',
		dim: ['255;40;30', '110;10;10'],
		count,
		rate: RATE.alert,
		left: 1 - count / (notice.total + ALERT_TAIL),
	}
}

// ALERT holds through the trace's first bar; EVASION and CAUTION share the rest, CAUTION running
// a second past the third bar.
function later_phase(cooled: number): Phase | undefined {
	if (cooled < EVASION_END) {
		const count = cooled - ALERT_TAIL

		return {
			label: 'EVASION',
			color: '255;210;60',
			dim: ['150;120;30', '70;55;10'],
			count,
			rate: RATE.after,
			left: 1 - count / EVASION_TICKS,
		}
	}

	if (cooled >= NOTICE_END) return undefined
	const count = cooled - EVASION_END

	return {
		label: 'CAUTION',
		color: '255;140;40',
		dim: ['140;75;20', '70;35;10'],
		count,
		rate: RATE.after,
		left: 1 - count / (NOTICE_END - EVASION_END),
	}
}

// The alert phases follow the notice: ALERT while it types and a second after, then EVASION, CAUTION.
function phase_of(state: ThemeState, tick: number): Phase | undefined {
	const { notice } = state

	if (notice.index < 0) return undefined
	if (notice.is_typing || notice.cooled < ALERT_TAIL) return alert_phase(notice, tick)

	return later_phase(notice.cooled)
}

function counter_of(now: Phase): string {
	return Math.max(0, COUNTER.top - now.count * now.rate)
		.toFixed(COUNTER.places)
		.padStart(COUNTER.w, '0')
}

// What the status block shows: its label, the countdown, the gauge's lit cells and colors.
interface Status {
	label: string
	label_style: string
	counter: string
	counter_color: string
	cells: number
	gauge_color: string
}

// The status block's rows count from the area's rule (joshuafolkken/kit#8917: the demo's rows 5 and 6).
const STATUS = { w: 19, cells: 12, gauge_x: 7, life_x: 5, life: 14, label_y: 1, gauge_y: 2 }
const IDLE_GREEN = '70;150;95'
const IDLE_STATUS: Status = {
	label: 'INFILTRATION',
	label_style: fg(IDLE_GREEN),
	counter: '--.--',
	counter_color: IDLE_GREEN,
	cells: 0,
	gauge_color: '45;100;65',
}

function status_of(now: Phase | undefined): Status {
	if (!now) return IDLE_STATUS

	return {
		label: now.label,
		label_style: `${fg('20;10;0')}${BOLD}${bg(now.color)}`,
		counter: counter_of(now),
		counter_color: now.color,
		cells: Math.max(0, Math.round(now.left * STATUS.cells)),
		gauge_color: now.color,
	}
}

// The LIFE bar under the status gauge.
function life_row(paint: Paint, at: Point): void {
	put(paint.grid, at, 'LIFE ', STYLE.body)
	put(
		paint.grid,
		{ ...at, x: at.x + STATUS.life_x },
		'█'.repeat(STATUS.life),
		life_color(paint.tick),
	)
}

function status_block(codec: Codec, paint: Paint, now: Phase | undefined): void {
	const { grid } = paint
	const { px, area_top } = codec.layout
	const status = status_of(now)
	const gauge_y = area_top + STATUS.gauge_y
	const label_at = { y: area_top + STATUS.label_y, x: px }

	put(grid, label_at, centered(status.label, STATUS.w), status.label_style)
	put(grid, { y: gauge_y, x: px }, ` ${status.counter} `, `${fg(status.counter_color)}${BOLD}`)
	const gauge_at = { y: gauge_y, x: px + STATUS.gauge_x }

	put(grid, gauge_at, gauge(status.cells, STATUS.cells), fg(status.gauge_color))
	life_row(paint, { y: gauge_y + 1, x: px })
}

// The plate's rows count from the area's rule (joshuafolkken/kit#8917: the demo's rows 5, 9 and 10).
const PLATE = { top: 1, rows: 6, pad: 5, digits: 6, gauge: 5, gauge_pad: 3, jamming: 6 }
const SIDES = 2
const PLATE_BG = bg('40;0;0')
const JAM_LOOK = { alert: 0.92, evasion: 0.45 }
const FLASH = { every: 8, lit: 4, jam_every: 10, jam_lit: 6 }

// The plate's place: the area's rule row, the countdown's left column and its width.
interface PlateAt {
	top: number
	x: number
	width: number
}

// The plate, its label (blinking while the alert itself holds) and JAMMING blinking under it.
function plate_back(grid: Grid, at: PlateAt, now: Phase, tick: number): void {
	const plate_w = at.width + PLATE.pad * SIDES
	const is_flash = now.label === 'ALERT' && tick % FLASH.every < FLASH.lit
	const style = is_flash ? STYLE.alarm : `${fg('20;10;0')}${BOLD}${bg(now.color)}`
	const x = at.x - PLATE.pad
	const top = at.top + PLATE.top

	for (let row = 0; row < PLATE.rows; row++) {
		put(grid, { y: top + row, x }, repeated(' ', plate_w), PLATE_BG)
	}

	put(grid, { y: top, x }, centered(now.label, plate_w), style)
}

function plate_jamming(grid: Grid, at: PlateAt, now: Phase, tick: number): void {
	if (now.label !== 'ALERT' || tick % FLASH.jam_every >= FLASH.jam_lit) return
	const plate_w = at.width + PLATE.pad * SIDES
	const jam_at = { y: at.top + PLATE.jamming, x: at.x - PLATE.pad }

	put(grid, jam_at, centered('JAMMING', plate_w), STYLE.alarm)
}

// The plate's place for a countdown `width` columns wide: centred on the board, from the area's rule.
function plate_at(codec: Codec, width: number): PlateAt {
	const { area_top, edge } = codec.layout

	return { top: area_top, x: Math.floor((edge - width) / SIDES), width }
}

// The countdown on a plate in the middle of the area, its gauge under it, JAMMING blinking.
function alert_plate(codec: Codec, paint: Paint, now: Phase): void {
	const { grid, tick } = paint
	const counter = counter_of(now)
	const width = big_width(counter)
	const at = plate_at(codec, width)
	const cells = Math.max(0, Math.round(now.left * (width + PLATE.digits)))
	const gauge_at = { y: at.top + PLATE.gauge, x: at.x - PLATE.gauge_pad }

	plate_back(grid, at, now, tick)
	big_number(grid, { y: at.top + PLATE.top + 1, x: at.x }, counter, {
		style: `${fg(now.color)}${BOLD}${PLATE_BG}`,
	})
	put(grid, gauge_at, gauge(cells, width + PLATE.digits), `${fg(now.color)}${PLATE_BG}`)
	plate_jamming(grid, at, now, tick)
}

// ALERT and EVASION take the area: the radar jammed across it, the countdown on a plate in the middle.
function alert_screen(codec: Codec, paint: Paint, now: Phase): void {
	const jam = now.label === 'ALERT' ? JAM_LOOK.alert : JAM_LOOK.evasion

	radar(codec, paint, codec.big_radar, { jam, is_contact: false, frame: now.color })
	alert_plate(codec, paint, now)
}

const ARROWS = { pace: 2, most: 4 }

// The area is full of the jammed radar and the countdown, so ALERT overflows into the header: a
// three-row banner on the left, marks on the right, and a warning along the gauge row.
function alert_header(codec: Codec, grid: Grid, tick: number): void {
	const { head_left, head_right, head_top } = codec.layout
	const is_on = tick % FLASH.every < FLASH.lit
	const style = is_on ? STYLE.alarm : `${fg('255;230;60')}${BOLD}${bg('110;10;10')}`
	const count = 1 + (Math.floor(tick / ARROWS.pace) % ARROWS.most)
	const shout = `${repeated('▶', count)} ENEMY ALERT ${LEFT_ARROW.repeat(count)}`

	codec.api.block(grid, head_left, style)
	banner(grid, head_left, '! ALERT !', style)
	codec.api.block(grid, head_right, style)
	banner(grid, head_right, '! ! !', style)
	put(grid, { y: 0, x: head_top.x }, centered(shout, head_top.w), style)
}

// Every section below the alert screen pulses red while the alert holds, not the lanes alone.
const PULSE = { every: 16, lit: 3 }

function alert_pulse(codec: Codec, paint: Paint): void {
	if (paint.tick % PULSE.every >= PULSE.lit) return
	restyle(
		paint.grid,
		([, style], _, y) => y > codec.layout.area_end && !style.startsWith('\u{1B}['),
		() => fg('255;70;60'),
	)
}

const WAVE = { alert: 0.9, after: 0.5, spread: 0.6, steps: 4 }

// How far along the wave a cell is, in five steps from dark to bright; the wave runs down and to
// the right, faster while the alert itself holds.
function wave_share(now: Phase, x: number, y: number, tick: number): number {
	const speed = now.label === 'ALERT' ? WAVE.alert : WAVE.after
	const wave = (Math.sin((x + y) * WAVE.spread - tick * speed) + 1) / SIDES

	return Math.round(wave * WAVE.steps) / WAVE.steps
}

// The first word of a section's row — its mark (BD, //, <-, >=, OK, :) or, where a row has none,
// its first word: the cells from the row indent up to the first blank, on rows that are not rules.
const LEAD_X = 5
const LEAD_MAX = 12

function is_word_cell(row: Array<Cell>, x: number): boolean {
	const cell = row[x]

	return cell !== undefined && cell[0] !== ' '
}

function lead_end(row: Array<Cell>): number {
	const [first] = row

	if (first && is_rule(first)) return LEAD_X
	let end = LEAD_X

	while (end < LEAD_X + LEAD_MAX && is_word_cell(row, end)) end += 1

	return end
}

function wave_row(grid: Grid, y: number, now: Phase, tick: number): void {
	const end = lead_end(grid[y] ?? [])

	for (let x = LEAD_X; x < end; x++) {
		const color = mixed(now.dim[1], now.color, wave_share(now, x, y, tick))

		set_cell(grid, { y, x }, [cell_at(grid, y, x)[0], `${fg(color)}${BOLD}`])
	}
}

// While an alert phase holds, a gradient wave runs along every rule and through the first word of
// every row in every section below the header — LANES, PROCESSES, FINDINGS, QUEUED, WAITING, DONE —
// the rules in the phase's dim colors, the first words up to its full color.
function alert_wave(layout: ThemeLayout, grid: Grid, now: Phase, tick: number): void {
	restyle(grid, is_rule, (x, y) => fg(mixed(now.dim[1], now.dim[0], wave_share(now, x, y, tick))))
	for (let y = layout.area_end + 1; y < grid.length; y++) wave_row(grid, y, now, tick)
}

const run_board_theme_codec_alert = {
	alert_header,
	alert_pulse,
	alert_screen,
	alert_wave,
	counter_of,
	lead_end,
	phase_of,
	status_block,
	wave_share,
}

export { run_board_theme_codec_alert }
export type { Phase }
