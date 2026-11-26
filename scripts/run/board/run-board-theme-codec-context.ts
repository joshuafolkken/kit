import { issue_cite } from '#scripts/issue/issue-cite'
import type {
	Box,
	Grid,
	Point,
	ThemeApi,
	ThemeLayout,
	ThemeState,
} from './run-board-theme-host-types'

// What the codec theme's drawings share (joshuafolkken/kit#8917): the frame being drawn, and the
// places the confirmed theme demo derives from the board's layout once — the three radars, the
// codec's place on the screen, the new lane's words and the "!" and "?" marks.

// The frame being drawn.
interface Paint {
	grid: Grid
	s: ThemeState
	tick: number
}

// "!" on a notice, "?" on a new lane: its glyph and column, the row's flash, its two blinking
// looks, and (for a mark that stays while its row types) the ticks between the row's flashes.
interface Mark {
	glyph: string
	x: number
	edge: number
	flash: string
	on: string
	off: string
	ink: string
	repeat?: number
}

// The new lane's row, read off the frame: its stage mark, its title and its estimate.
interface Lane {
	stage: string
	title: string
	eta: string
}

interface Codec {
	api: ThemeApi
	layout: ThemeLayout
	small_radar: Box
	big_radar: Box
	side_radar: Box
	codec_at: Point
	lane: Lane
	log_lines: ReadonlyArray<[string, string]>
	alert_mark: Mark
	query_mark: Mark
}

// Its row counts from the area's rule (joshuafolkken/kit#8917: the demo's row 5).
const SMALL_RADAR = { inset: 25, y: 1, w: 25, h: 7 }
const SIDE_RADAR_W = 30
const CODEC = { w: 58, h: 10 }
const HALF = 2
const LANE = { stage: 2, title: 30, mark_back: 4 }
const TITLE_FROM = '** '
const TITLE_END = /\s\s->/u
const ETA = /-> (?<eta>\d\d:\d\d)/u

// The title: the words after "** " up to the blanks before the estimate's arrow.
function title_of(row_text: string): string {
	const from = row_text.indexOf(TITLE_FROM)

	if (from === -1) return ''
	const rest = row_text.slice(from + TITLE_FROM.length)
	const end = rest.search(TITLE_END)

	return end < 1 ? '' : rest.slice(0, end).trimEnd()
}

function eta_of(row_text: string): string {
	return ETA.exec(row_text)?.groups?.['eta'] ?? '--:--'
}

function lane_of(row_text: string): Lane {
	return {
		stage: row_text.slice(0, LANE.stage),
		title: title_of(row_text).slice(0, LANE.title),
		eta: eta_of(row_text),
	}
}

function log_lines_of(new_lane: string, lane: Lane): ReadonlyArray<[string, string]> {
	return [
		['CONTACT', `NEW LANE ${issue_cite.plain_for('terminal', new_lane)}`],
		['STAGE', `${lane.stage} · PLANNING`],
		['OBJECTIVE', lane.title],
		['ETA', `-> ${lane.eta}`],
	]
}

function radars_of(layout: ThemeLayout): Pick<Codec, 'big_radar' | 'side_radar' | 'small_radar'> {
	const { edge, area_top, area_end } = layout
	const area_h = area_end - area_top + 1

	return {
		small_radar: {
			x: edge - SMALL_RADAR.inset,
			y: area_top + SMALL_RADAR.y,
			w: SMALL_RADAR.w,
			h: SMALL_RADAR.h,
		},
		big_radar: { x: 0, y: area_top, w: edge, h: area_h },
		side_radar: { x: edge - SIDE_RADAR_W, y: area_top, w: SIDE_RADAR_W, h: area_h },
	}
}

function marks_of(layout: ThemeLayout): Pick<Codec, 'alert_mark' | 'query_mark'> {
	const { edge } = layout

	return {
		alert_mark: {
			glyph: '!',
			x: layout.notice.x - LANE.mark_back,
			edge,
			flash: '200;20;20',
			on: '230;30;30',
			off: '170;10;10',
			ink: '255;230;60',
		},
		query_mark: {
			glyph: '?',
			x: 1,
			edge,
			flash: '120;95;10',
			on: '230;180;20',
			off: '120;90;0',
			ink: '30;20;0',
			repeat: 40,
		},
	}
}

function codec_of(api: ThemeApi): Codec {
	const { layout } = api
	const lane = lane_of(layout.row_text)
	const codec_at = {
		x: layout.screen_cx - Math.floor(CODEC.w / HALF),
		y: layout.screen_cy - Math.floor(CODEC.h / HALF),
	}

	return {
		api,
		layout,
		...radars_of(layout),
		codec_at,
		lane,
		log_lines: log_lines_of(layout.new_lane, lane),
		...marks_of(layout),
	}
}

const run_board_theme_codec_context = { CODEC, codec_of, lane_of }

export { run_board_theme_codec_context }
export type { Codec, Lane, Mark, Paint }
