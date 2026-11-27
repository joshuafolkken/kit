import { run_board_theme_deviant_after } from './run-board-theme-deviant-after'
import { run_board_theme_deviant_analysis } from './run-board-theme-deviant-analysis'
import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_ending } from './run-board-theme-deviant-ending'
import { run_board_theme_deviant_header } from './run-board-theme-deviant-header'
import { run_board_theme_deviant_idle } from './run-board-theme-deviant-idle'
import { run_board_theme_deviant_led } from './run-board-theme-deviant-led'
import { run_board_theme_deviant_link } from './run-board-theme-deviant-link'
import { run_board_theme_deviant_note } from './run-board-theme-deviant-note'
import { run_board_theme_deviant_opening } from './run-board-theme-deviant-opening'
import { run_board_theme_deviant_panel, type PanelLook } from './run-board-theme-deviant-panel'
import { run_board_theme_deviant_parts } from './run-board-theme-deviant-parts'
import { run_board_theme_deviant_rules } from './run-board-theme-deviant-rules'
import { run_board_theme_deviant_stamp } from './run-board-theme-deviant-stamp'
import { run_board_theme_deviant_wall } from './run-board-theme-deviant-wall'
import { run_board_theme_deviant_watch } from './run-board-theme-deviant-watch'
import { run_board_theme_draw, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type {
	Point,
	ThemeApi,
	ThemeLayout,
	ThemeModule,
	ThemeState,
} from './run-board-theme-host-types'

// The deviant theme: the screens of Detroit: Become Human — night navy, grey-blue text, steel-blue
// rules — each part drawn as the confirmed design draws it, placed by the board's own layout.
// Idle: the choice list △ □ ○ ✕ with its fading cursor plate, the breathing triangle, the date card;
// a faint blue scan band passes down the board now and then, and a reticle watches a number.
// PROGRESS: the clue analysis in the panel and on the rules; the board eases into scan mode,
// brackets hop over the data.
// ROW: the board sinks into scan blue and the reconstruction view takes THROUGHPUT and USAGE — the
// stamped fact, the lane's line-art, the timeline, the head's line down the board.
// NOTICE: the order's prompt in the header; the board freezes grey and the red wall of orders
// grows, cracks and shatters; color returns in a ring and the objective is stamped; SOFTWARE
// INSTABILITY stays on the model line until the notice ends.
// Always: the lanes' marks as LEDs (`run-board-theme-deviant-led.ts`) and the small notices on the
// THROUGHPUT rule (`run-board-theme-deviant-note.ts`).

const { notice_trace } = run_board_theme_host_flash
const { put_level } = run_board_theme_host_grid
const { NOTICE_END, PEAK_TICKS } = run_board_theme_host_state
const { share_of } = run_board_theme_draw
const { MODEL, RGB, SCAN, STRESS, WALL, theme_colors, theme_notes } = run_board_theme_deviant_data
const { after } = run_board_theme_deviant_after
const { analysis, hopping_brackets, is_analyzing, scan_mode } = run_board_theme_deviant_analysis
const { close, open } = run_board_theme_deviant_header
const { glitch, rule_glints, scan_tint } = run_board_theme_deviant_idle
const { SPINNER, leds } = run_board_theme_deviant_led
const { link } = run_board_theme_deviant_link
const { note } = run_board_theme_deviant_note
const { idle } = run_board_theme_deviant_panel
const { ink, mix } = run_board_theme_deviant_parts
const { rule_bar, rule_inks } = run_board_theme_deviant_rules
const { is_stamping, stamp } = run_board_theme_deviant_stamp
const { build, hits_passed, wall_age, wall_wash } = run_board_theme_deviant_wall
const { watch } = run_board_theme_deviant_watch

// Whether an event plays: the wall or its mark, the reconstruction, or the analysis.
function is_playing(state: ThemeState): boolean {
	return wall_age(state, state.tick) >= 0 || is_stamping(state) || is_analyzing(state)
}

// The stress the level reads: the board's real level, calm where none is given; through a NOTICE
// its own climb to the peak and its ease back.
function stress_of(state: ThemeState, age: number): number {
	if (age < 0) return (STRESS.calm - (state.event.level ?? STRESS.calm)) * STRESS.step + STRESS.base

	const { notice } = state
	const share = notice.is_typing ? age / PEAK_TICKS : 1 - share_of(notice.cooled, 0, NOTICE_END)

	return Math.round(share * STRESS.full)
}

// How the panel stands a NOTICE `age` ticks old, at rest below 0: the mark from its peak, the alarm
// until then, the wall's hits, and the stress the level reads.
function panel_look(state: ThemeState, age: number, hits: number): PanelLook {
	return {
		has_mark: age >= PEAK_TICKS,
		is_alarm: age >= 0 && age < PEAK_TICKS,
		hits,
		stress: stress_of(state, age),
	}
}

// This theme's own level, flush with the rule's right end: blue, red through a NOTICE.
function level(draw: ThemeDraw, age: number): void {
	const { api, grid, s } = draw
	const text = ` STRESS ${String(stress_of(s, age))}%`

	put_level(grid, api.layout.level_spot, text, ink(age < 0 ? RGB.blue : RGB.red))
}

// PROGRESS: scan mode on the board, the bar on the rules, brackets on the data, the analysis in the panel.
function analyzing(draw: ThemeDraw): void {
	scan_mode(draw)
	rule_bar(draw)
	hopping_brackets(draw)
	analysis(draw)
}

// Idle: the panel and its link line, the reticle that watches a number, the glints along the rules
// and the glitch.
function resting(draw: ThemeDraw): void {
	idle(draw, panel_look(draw.s, -1, 0))
	link(draw)
	watch(draw)
	rule_glints(draw)
	glitch(draw)
}

// The board while no notice plays: a lane's reconstruction over a line's analysis, else at rest.
function board(draw: ThemeDraw): void {
	if (is_stamping(draw.s)) stamp(draw)
	else if (is_analyzing(draw.s)) analyzing(draw)
	else resting(draw)
}

// NOTICE `age` ticks old, in its four acts: the order's prompt in the header; the wall building
// over the frozen board; the peak; the afterglow. The header's blocks are drawn over the wall.
function notice_acts(draw: ThemeDraw, age: number): void {
	const kept = open(draw, age)
	const built = age - WALL.from

	idle(draw, panel_look(draw.s, age, hits_passed(built)))
	if (built >= 0 && age < PEAK_TICKS) build(draw, built)
	if (age >= PEAK_TICKS) after(draw, age - PEAK_TICKS)
	close(draw, age, kept)
}

function deviant(draw: ThemeDraw): void {
	const { grid, s, tick } = draw
	const age = wall_age(s, tick)

	leds(draw)
	rule_inks(draw)
	if (age < 0) board(draw)
	else notice_acts(draw, age)
	notice_trace(grid, s, RGB.red)
	level(draw, age)
	note(draw)
}

// The wash behind every cell: the night; the wall's red through a NOTICE's build; the scan band's
// faint blue on the idle board.
function background(layout: ThemeLayout, at: Point, state: ThemeState): string {
	const age = wall_age(state, state.tick)

	if (age >= 0) return wall_wash(layout, at.x, age)
	if (is_playing(state)) return RGB.night
	const tint = scan_tint(layout, at.y, state.tick)

	return tint > 0 ? mix(RGB.night, RGB.blue, tint * SCAN.tint) : RGB.night
}

function theme(api: ThemeApi): ThemeModule {
	return {
		name: 'DETROIT',
		board: MODEL.board,
		spinner: SPINNER,
		colons: true,
		notes: theme_notes,
		colors: theme_colors,
		background: (x, y, _, state) => background(api.layout, { x, y }, state),
		opening: run_board_theme_deviant_opening.opening_of(api),
		ending: run_board_theme_deviant_ending.ending_of(api),
		draw: (grid, state, tick) => {
			deviant({ api, grid, s: state, tick })
		},
		playing: is_playing,
	}
}

const run_board_theme_deviant = { theme }

export { run_board_theme_deviant }
