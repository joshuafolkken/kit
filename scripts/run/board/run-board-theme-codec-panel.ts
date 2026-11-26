import { run_board_theme_codec_alert, type Phase } from './run-board-theme-codec-alert'
import { run_board_theme_codec_call } from './run-board-theme-codec-call'
import type { Codec, Mark, Paint } from './run-board-theme-codec-context'
import { run_board_theme_codec_data } from './run-board-theme-codec-data'
import { run_board_theme_codec_radar } from './run-board-theme-codec-radar'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Channel, Grid, ThemeState } from './run-board-theme-host-types'

// The codec theme's panel (joshuafolkken/kit#8917), ported from the confirmed theme demo: idle, the
// status block, the codec on standby scanning its memory and the radar sweeping; the "!" and "?"
// marks; and idle, a faint sweep of light across the whole screen.

const { BOLD, ESC, bg, fg, put, put_level, restyle } = run_board_theme_host_grid
const { active } = run_board_theme_host_state
const { CODEC_FREQUENCIES, STYLE, freq_at } = run_board_theme_codec_data
const { blip_level, dialing, level_bars } = run_board_theme_codec_call
const { counter_of, status_block } = run_board_theme_codec_alert
const { radar, radar_idle } = run_board_theme_codec_radar

// Idle, the standby codec scans its memory: every six seconds the frequency dials round to the
// next stored channel.
const SCAN_TICKS = 120
const SCAN_SALT = 8
const DIAL_SETTLE = 14

function scanned_freq(tick: number): string {
	const freq = freq_at(Math.floor(tick / SCAN_TICKS))

	return dialing(freq, tick % SCAN_TICKS, tick, SCAN_SALT)
}

// The rows count from the area's rule (joshuafolkken/kit#8917: the demo's rows 9, 10 and 6).
const CODEC_ROW = { y: 5, freq_x: 6, mem_x: 13, bars_y: 6, double: 2 }
const STANDBY = { long: 19, short: 7 }
const STANDBY_BARS: ReadonlyArray<number> = [STANDBY.long, STANDBY.short]
const CLOCK = { from: 872, pace: 20, hour: 3600, minute: 60, w: 19, y: 2, digits: 2 }

function mission_clock(tick: number): string {
	const seconds = CLOCK.from + Math.floor(tick / CLOCK.pace)
	const parts = [
		Math.floor(seconds / CLOCK.hour),
		Math.floor(seconds / CLOCK.minute) % CLOCK.minute,
		seconds % CLOCK.minute,
	]

	return parts.map((part) => String(part).padStart(CLOCK.digits, '0')).join(':')
}

// With no alert phase: the mission clock runs where the countdown would be, MEM names the channel
// the codec is on, and the radar sweeps and pings.
function idle_clock(codec: Codec, paint: Paint): void {
	const { grid, tick } = paint
	const { px, area_top } = codec.layout
	const memory = (Math.floor(tick / SCAN_TICKS) % CODEC_FREQUENCIES.length) + 1
	const memory_style = tick % SCAN_TICKS < DIAL_SETTLE ? STYLE.pale_bold : STYLE.green_dim
	const mem_at = { y: area_top + CODEC_ROW.y, x: px + CODEC_ROW.mem_x }

	put(
		grid,
		{ y: area_top + CLOCK.y, x: px },
		` TIME ${mission_clock(tick)}`.padEnd(CLOCK.w),
		fg('110;200;140'),
	)
	put(grid, mem_at, `MEM ${String(memory)}`, memory_style)
	radar_idle(grid, codec.small_radar, tick)
}

// An alert phase's label and countdown in the level spot.
function phase_spot(codec: Codec, grid: Grid, now: Phase): void {
	const text = ` ${now.label} ${counter_of(now)}`

	put_level(grid, codec.layout.level_spot, text, `${fg(now.color)}${BOLD}`)
}

// Idle: the status block, the codec on standby and the radar in the panel.
function idle_panel(codec: Codec, paint: Paint, now: Phase | undefined): void {
	const { grid, s, tick } = paint
	const { px, area_top } = codec.layout
	const freq = now ? freq_at(Math.max(0, s.progress.index)) : scanned_freq(tick)
	const bars_at = { y: area_top + CODEC_ROW.bars_y, x: px }

	status_block(codec, paint, now)
	put(grid, { y: area_top + CODEC_ROW.y, x: px }, 'CODEC', STYLE.green_dim)
	put(grid, { y: area_top + CODEC_ROW.y, x: px + CODEC_ROW.freq_x }, freq, fg('90;190;120'))
	level_bars(grid, bars_at, STANDBY_BARS, blip_level(tick) * CODEC_ROW.double)
	radar(codec, paint, codec.small_radar, {
		jam: 0,
		is_contact: false,
		frame: now ? now.color : '80;170;105',
	})
	if (now) phase_spot(codec, grid, now)
	else idle_clock(codec, paint)
}

const MARK = { tail: 20, shown: 24, beat: 4, lit: 2 }

function is_mark_shown(typed: Channel, look: Mark, age: number): boolean {
	if (typed.index < 0) return false

	return look.repeat ? active(typed, MARK.tail) : age < MARK.shown
}

function mark_beat(typed: Channel, look: Mark, age: number): number {
	return look.repeat && typed.is_typing ? age % look.repeat : age
}

// "!" on a notice, "?" on a new lane: the row flashes, then the mark blinks beside it. A mark with
// `repeat` stays, blinking, until its row has typed through (and a second more), and the row's
// flash comes back every `repeat` ticks while it types.
function mark(grid: Grid, typed: Channel, tick: number, look: Mark): void {
	const age = tick - typed.start

	if (!is_mark_shown(typed, look, age)) return
	const { y } = typed.span
	const beat = mark_beat(typed, look, age)
	const is_lit = age % MARK.beat < MARK.lit
	const style = is_lit ? `${STYLE.white}${bg(look.on)}` : `${fg(look.ink)}${BOLD}${bg(look.off)}`

	if (beat < MARK.beat && beat % MARK.lit === 0) {
		restyle(
			grid,
			(_, x, yy) => yy === y && x < look.edge,
			() => `${STYLE.white}${bg(look.flash)}`,
		)
	}

	put(grid, { y, x: look.x }, ` ${look.glyph} `, style)
}

// Nothing is happening: no event types and the last one finished long enough ago that every
// theme's afterglow is over. A theme's whole-screen idle touch plays only then.
const QUIET_TICKS = 150

function is_quiet(state: ThemeState): boolean {
	return !state.busy && state.since >= QUIET_TICKS
}

const SWEEP = { every: 160, pace: 3, w: 3 }

// Idle, across the whole screen: every eight seconds a faint line of light sweeps from the radar's
// side to the left edge, brightening the text it passes for a moment — the radar's reach.
function idle_sweep(codec: Codec, paint: Paint): void {
	const x = codec.layout.edge - 1 - (paint.tick % SWEEP.every) * SWEEP.pace

	if (!is_quiet(paint.s) || x < -SWEEP.w) return
	restyle(
		paint.grid,
		([ch, style], xx) => ch !== ' ' && xx >= x && xx < x + SWEEP.w && !style.startsWith(ESC),
		(xx) => fg(xx === x ? '225;255;230' : '170;240;185'),
	)
}

const run_board_theme_codec_panel = {
	idle_panel,
	idle_sweep,
	is_quiet,
	mark,
	mission_clock,
	scanned_freq,
}

export { run_board_theme_codec_panel }
