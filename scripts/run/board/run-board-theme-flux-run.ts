import { run_board_theme_flux_bolts } from './run-board-theme-flux-bolts'
import { run_board_theme_flux_context, type FluxContext } from './run-board-theme-flux-context'
import { run_board_theme_flux_data } from './run-board-theme-flux-data'
import { run_board_theme_flux_motion } from './run-board-theme-flux-motion'
import { run_board_theme_flux_paint } from './run-board-theme-flux-paint'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Grid, Point, ThemeState } from './run-board-theme-host-types'

// The BTTF theme's run up to the JUMP (joshuafolkken/kit#8917): the notice's lane whitening, arcs
// crackling in the last 0.75 s, and bolts crawling over the screen, more as the run climbs. Ported
// from the confirmed theme demo's `fixed-v21-theme-bttf.mjs`.

const { draw_swarm, place_in } = run_board_theme_flux_bolts
const { is_kept } = run_board_theme_flux_context
const { ARC, WHITE } = run_board_theme_flux_data
const { LEAD_TICKS } = run_board_theme_flux_motion
const { is_blank, mix, noise, paint, recolor } = run_board_theme_flux_paint
const { cell_at, code_points, pick, set_cell } = run_board_theme_host_grid

const ISSUE = /#(?<issue>\d{4})/u
const ISSUE_DIGITS = 4
const TENTHS = 10
const LANE_WHITE = 0.7
const HEADER_ROWS = 3
const ARC_SHARE = 0.05
const ARC_TINT_SHARE = 0.3
const ARC_TINT = 0.8
const ARC_SALT = 500
const ARC_GLYPHS = code_points('╱╲│─┼')

// BOLTS (bttf-bolts-theme-demo.mjs): anywhere on the screen, more as the run climbs, about 40 a
// frame at the jump.
const BOLT_SPAWN = 27
const RAMP_SHARE = 0.4

// The arcs' place in the run: the lane they cross, the ticks from the jump, the tick.
interface Run {
	lane: number | undefined
	t: number
	tick: number
}

// The lane of the notice's issue, if the board shows it.
function lane_of(context: FluxContext, state: Pick<ThemeState, 'notice'>): number | undefined {
	const issue = ISSUE.exec(state.notice.text)?.groups?.['issue']
	const { issue_x, lane_rows } = context.layout

	if (!issue) return undefined

	return lane_rows.find(
		(y) => context.api.plain(y).slice(issue_x, issue_x + ISSUE_DIGITS) === issue,
	)
}

// The notice's lane whitens through the run, in tenths so a cell changes a few times only.
function whiten_lane(context: FluxContext, grid: Grid, y: number | undefined, share: number): void {
	if (y === undefined) return
	const stepped = Math.floor(share * TENTHS) / TENTHS

	for (let x = 0; x < context.layout.w; x++) {
		if (is_blank(cell_at(grid, y, x))) continue
		recolor(grid, { y, x }, (look) => ({ f: mix(look.f, WHITE, stepped * LANE_WHITE), b: look.b }))
	}
}

function arc_rows(context: FluxContext, lane: number | undefined): Array<number> {
	const { area_end, area_top } = context.layout
	const header = Array.from({ length: HEADER_ROWS }, (_, y) => y)
	const panel = Array.from({ length: area_end - area_top }, (_, index) => area_top + 1 + index)

	return lane === undefined ? [...header, ...panel] : [...header, ...panel, lane]
}

function arc_cell(context: FluxContext, grid: Grid, at: Point, run: Run & { share: number }): void {
	const { x, y } = at
	const roll = noise(run.tick, x, y)

	if (roll < run.share * ARC_SHARE && !is_kept(context.layout, x, y)) {
		set_cell(grid, at, [pick(ARC_GLYPHS, noise(run.tick, x, y + ARC_SALT)), paint(ARC)])
	} else if (roll < run.share * ARC_TINT_SHARE) {
		recolor(grid, at, (look) => ({ f: mix(look.f, ARC, ARC_TINT), b: look.b }))
	}
}

// In the last 0.75 s arcs crackle over the header, the panel's rows and the lane.
function draw_arcs(context: FluxContext, grid: Grid, run: Run): void {
	if (run.t < -LEAD_TICKS) return
	const share = (run.t + LEAD_TICKS) / LEAD_TICKS

	for (const y of arc_rows(context, run.lane)) {
		for (let x = 0; x < context.layout.w; x++) arc_cell(context, grid, { x, y }, { ...run, share })
	}
}

function bolts_born(t: number, letters: number): number {
	if (t < -letters || t >= 0) return 0
	const ramp = Math.min(1, (t + letters) / (letters - LEAD_TICKS)) * RAMP_SHARE
	const flood = Math.max(0, (t + LEAD_TICKS) / LEAD_TICKS) * (1 - RAMP_SHARE)

	return Math.round(BOLT_SPAWN * (ramp + flood))
}

// Every bolt alive over the whole screen, but never on the notice or the progress words.
function draw_bolts(context: FluxContext, grid: Grid, t: number, letters: number): void {
	const { h, w } = context.layout

	draw_swarm(grid, {
		now: t,
		count: (born) => bolts_born(born, letters),
		seed: (born) => born,
		place: place_in({ left: 0, top: 0, w, h }),
		can_draw: (x, y) => !is_kept(context.layout, x, y),
	})
}

const run_board_theme_flux_run = { bolts_born, draw_arcs, draw_bolts, lane_of, whiten_lane }

export { run_board_theme_flux_run }
export type { Run }
