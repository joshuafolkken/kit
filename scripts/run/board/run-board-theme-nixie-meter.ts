import { run_board_theme_host_fonts } from './run-board-theme-host-fonts'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { ThemeState } from './run-board-theme-host-types'
import { run_board_theme_nixie_data, type NixieDraw } from './run-board-theme-nixie-data'
import { run_board_theme_nixie_idle } from './run-board-theme-nixie-idle'

// STEINS;GATE's divergence meter (joshuafolkken/kit#8917), ported from the confirmed theme demo: in
// the panel, flush with the rules' right end, its tubes spin while an event types and lock one by
// one on the world line the event reached; idle, they breathe.

const { big_digit, big_width } = run_board_theme_host_fonts
const { BOLD, digit, fg, put, put_level } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { LINGER, finished } = run_board_theme_host_state
const {
	ALPHA_LINES,
	BETA_LINES,
	BLINK,
	COLOR,
	FIRST_ALPHA,
	IDLE_AFTER,
	LOCK_STEP,
	METER_DIGITS,
	nth,
} = run_board_theme_nixie_data
const { is_swelling } = run_board_theme_nixie_idle

const METER_W = big_width(FIRST_ALPHA)
// `y` is an offset from the area's top (joshuafolkken/kit#8917; the demo's area_top was 4).
const METER = { y: 1, rows: 3, point_step: 2, tube_step: 4 }
const SALT = { spin: 21, flutter: 22, dim: 31 }
// Idle: the last tube flutters for four ticks in seventy; now and then a tube drops dim.
const FLUTTER = { every: 70, ticks: 4 }
const DIM_SHARE = 0.02
const WHITE_TICKS = 30
const BREATH = { low: 0.82, depth: 0.18, speed: 0.12 }
const AMBER = { r: 255, g: 150, b: 40 }
const HALF = 2

interface World {
	value: string
	field: string
}

interface Tube {
	ch: string
	is_spinning: boolean
}

// A NOTICE lands on a β world line; any other event on the next α one.
function world_of(state: ThemeState): World {
	if (state.latest === 'notice') {
		return { value: nth(BETA_LINES, finished(state.notice) - 1), field: 'β' }
	}

	return {
		value: nth(ALPHA_LINES, finished(state.progress) + finished(state.row)),
		field: 'α',
	}
}

function is_flutter(frame: NixieDraw, value: string, index: number): boolean {
	const { state, tick } = frame
	const is_last = index === value.length - 1

	return state.since >= IDLE_AFTER && is_last && tick % FLUTTER.every < FLUTTER.ticks
}

function nixie_char(frame: NixieDraw, value: string, index: number): Tube {
	const { state, tick } = frame
	const ch = value.charAt(index)

	if (ch === '.') return { ch, is_spinning: false }

	if (state.busy || state.since < LOCK_STEP * index) {
		return { ch: digit(hash(tick, index, SALT.spin)), is_spinning: true }
	}

	// Idle: the last tube flutters for a moment every few seconds.
	if (is_flutter(frame, value, index)) {
		return { ch: digit(hash(tick, index, SALT.flutter)), is_spinning: true }
	}

	return { ch, is_spinning: false }
}

function is_blink_lit(tick: number): boolean {
	return tick % BLINK.every < BLINK.lit
}

// A PROGRESS or ROW has just landed: the tubes pulse after the last one locks.
function is_landed(state: ThemeState): boolean {
	const landed = state.since - LOCK_STEP * METER_DIGITS
	const is_alpha = state.latest !== undefined && state.latest !== 'notice'

	return !state.busy && is_alpha && landed >= 0 && landed < LINGER
}

// A β reading has just locked: the tubes flash white.
function is_beta_flash(state: ThemeState, tick: number): boolean {
	return state.latest === 'notice' && state.since < WHITE_TICKS && is_blink_lit(tick)
}

function event_glow(state: ThemeState, tick: number): string | undefined {
	if (is_landed(state)) return is_blink_lit(tick) ? COLOR.landed : COLOR.amber
	if (is_beta_flash(state, tick)) return COLOR.white

	return undefined
}

function breath_color(state: ThemeState, tick: number, index: number): string {
	const swing = BREATH.low + BREATH.depth * Math.sin(tick * BREATH.speed + index)
	const breath = state.since >= IDLE_AFTER ? swing : 1
	const red = Math.round(AMBER.r * breath)
	const green = Math.round(AMBER.g * breath)
	const blue = Math.round(AMBER.b * breath)

	return `${String(red)};${String(green)};${String(blue)}`
}

// Idle: each tube breathes, and now and then one drops dim for two ticks; the current along the
// rules arrives, and the tubes swell.
function idle_glow(frame: NixieDraw, index: number): string {
	const { state, tick } = frame

	if (is_swelling(state, tick, frame.api.layout.edge)) return COLOR.swell
	if (hash(Math.floor(tick / HALF), index, SALT.dim) < DIM_SHARE) return COLOR.dim

	return breath_color(state, tick, index)
}

function nixie_glow(frame: NixieDraw, is_spinning: boolean, index: number): string {
	if (is_spinning) return COLOR.spin

	return event_glow(frame.state, frame.tick) ?? idle_glow(frame, index)
}

function meter_label(frame: NixieDraw, world: World): void {
	const { grid, state, tick, api } = frame
	const is_shifting = state.busy || state.since < LOCK_STEP * world.value.length
	const label = is_shifting ? 'WORLD LINE SHIFTING…' : `${world.field} ATTRACTOR FIELD`
	const color = is_shifting && is_blink_lit(tick) ? COLOR.label : COLOR.amber

	put_level(grid, api.layout.level_spot, ` ${label}`, `${fg(color)}${BOLD}`)
}

// The meter's rows blanked from the cell before it, each cell keeping its style.
function meter_blank(frame: NixieDraw, x: number): void {
	const top = frame.api.layout.area_top + METER.y

	for (let row = 0; row < METER.rows; row++) {
		put(frame.grid, { y: top + row, x: x - 1 }, ' '.repeat(METER_W + 1))
	}
}

function divergence_meter(frame: NixieDraw): void {
	const { grid, api } = frame
	const world = world_of(frame.state)
	let x = api.layout.edge - METER_W

	meter_blank(frame, x)

	for (let index = 0; index < world.value.length; index++) {
		const { ch, is_spinning } = nixie_char(frame, world.value, index)
		const style = `${fg(nixie_glow(frame, is_spinning, index))}${BOLD}`

		big_digit(grid, { y: api.layout.area_top + METER.y, x }, ch, { style, ghost: fg(COLOR.ghost) })
		x += ch === '.' ? METER.point_step : METER.tube_step
	}

	meter_label(frame, world)
}

const run_board_theme_nixie_meter = {
	METER,
	METER_W,
	divergence_meter,
	nixie_char,
	nixie_glow,
	world_of,
}

export { run_board_theme_nixie_meter }
