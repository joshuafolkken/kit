import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Point, ThemeLayout } from './run-board-theme-host-types'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'
import { run_board_theme_wopr_phase } from './run-board-theme-wopr-phase'

// The WARGAMES theme's sixteen wars (joshuafolkken/kit#8917), ported from the confirmed theme demo:
// the map's land, each war's tracks and blobs, and the WINNER table's pace, all fixed by the layout.

const { hash } = run_board_theme_host_hash
const { TRACK_INKS, WAR_LENGTHS, WORLD } = run_board_theme_wopr_data
const { CLOSE_FROM, WAR_START } = run_board_theme_wopr_phase

// Where the NORAD map lies: the area's left half from the row under its rule, and the board's last
// row with text (the blobs over the rest of the screen stay on the rows up to it).
interface Sky {
	layout: ThemeLayout
	half: number
	sky: number
	bottom: number
	last_row: number
	land_cells: ReadonlyArray<Point>
}

interface Track {
	y0: number
	x0: number
	y1: number
	x1: number
	from: number
	to: number
	ink: string
}

interface Blob extends Point {
	from: number
}

interface War {
	start: number
	length: number
	tracks: Array<Track>
	blobs: Array<Blob>
}

const WAR_FLOOR = 7
// The white-out: three ticks, or two in a war under ten ticks.
const WHITE = { short: 10, long: 3, brief: 2 }
// Hash salts, as the demo numbers them.
const SALT = { land: 43, land_k: 7, spot_y: 44, spot_x: 45, bloom: 46, zone_x: 48, zone_y: 49 }
const SITE = { x: 50, y: 51, reach: 24, rows: 2, mid: 0.5, margin: 2 }
const ZONE = { columns: 8, bands: 2 }
const SPOT = { attempts: 8, margin: 2, span: 4 }
// Track j of war k: `18 + 2k` of them, at most 32; launched over the second to the half of the war,
// each flying a fifth of it; `3 + 3k` blobs, at most 18, from the war's middle.
const TRACKS = { first: 18, more: 2, most: 32, launch: 0.05, spread: 0.3, flight: 5 }
const BLOBS = { first: 3, more: 3, most: 18, from: 0.5, spread: 0.3 }
const WAR_SEED = 100
const PAIR = 2
// A blob over the screen keeps off the notice's text and the three cells before it.
const NOTICE_LEAD = 3
// The WINNER table's rows come 8 ticks apart at first, each gap 0.8 of the last, at least a tick.
const TABLE_PACE = { first: 8, ratio: 0.8 }

function is_land(row: number, col: number): boolean {
	return WORLD[row]?.[col] === '#'
}

function is_coast(row: number, col: number): boolean {
	return [
		[row - 1, col],
		[row + 1, col],
		[row, col - 1],
		[row, col + 1],
	].some(([near_row = 0, near_col = 0]) => !is_land(near_row, near_col))
}

// The map's land cells from row `sky`, or only its coast: a land cell with sea beside it.
function land_cells_of(sky: number, is_coast_only: boolean): Array<Point> {
	const cells = WORLD.flatMap((line, row) => Array.from(line, (_, col) => ({ row, col })))

	return cells
		.filter(({ row, col }) => is_land(row, col) && (!is_coast_only || is_coast(row, col)))
		.map(({ row, col }) => ({ y: sky + row, x: col }))
}

// The wars, quickening: 18, 15, 12, 10, 9, 8 ticks, then 7 a war until the ending (the last taking
// what is left) — sixteen in all.
function war_lengths(): Array<number> {
	const lengths = WAR_LENGTHS.split(' ').map(Number)
	let left = CLOSE_FROM - WAR_START - lengths.reduce((sum, each) => sum + each, 0)

	while (left >= WAR_FLOOR + WAR_FLOOR) {
		lengths.push(WAR_FLOOR)
		left -= WAR_FLOOR
	}

	lengths.push(left)

	return lengths
}

function white_ticks(war: War): number {
	return war.length < WHITE.short ? WHITE.brief : WHITE.long
}

function land_at(sky: Sky, seed: number): Point {
	const { land_cells } = sky
	const index = Math.floor(hash(seed, SALT.land_k, SALT.land) * land_cells.length)

	return land_cells[index] ?? { y: 0, x: 0 }
}

// A launch point near the target, across the map's height from it, so the track runs steep or
// diagonal: up to 12 columns to either side, in the other band of rows.
function near_site(sky: Sky, target: Point, war: number, track: number): Point {
	const shift = Math.round((hash(war, track, SITE.x) - SITE.mid) * SITE.reach)
	const x = Math.min(sky.half - SITE.margin, Math.max(1, target.x + shift))
	const rows = Math.floor(hash(war, track, SITE.y) * SITE.rows)
	const is_high = target.y - sky.sky < (sky.bottom - sky.sky) / ZONE.bands

	return { x, y: is_high ? sky.bottom - rows : sky.sky + rows }
}

// A target anywhere on the map, spread so a war hits all of it: the map is cut into 8 columns by 2
// bands of rows, track j aims at zone j (round again past 16), at a hashed spot inside it — a
// different spot in every war.
function target_at(sky: Sky, war: number, track: number): Point {
	const zone = track % (ZONE.columns * ZONE.bands)
	const width = sky.half / ZONE.columns
	const height = (sky.bottom - sky.sky + 1) / ZONE.bands
	const x = Math.floor((zone % ZONE.columns) * width + hash(war, track, SALT.zone_x) * width)
	const band = Math.floor(zone / ZONE.columns) * height
	const y = sky.sky + Math.floor(band + hash(war, track, SALT.zone_y) * height)

	return { x: Math.min(sky.half - SITE.margin, Math.max(1, x)), y: Math.min(sky.bottom, y) }
}

// Where a blob may draw on the board's area.
function in_area(sky: Sky, y: number, x: number): boolean {
	return y >= sky.sky && y <= sky.bottom && x >= 0 && x < sky.half
}

// Anywhere on the screen's text rows but the notice and the progress line.
function is_in_screen(sky: Sky, y: number, x: number): boolean {
	return y >= 0 && y <= sky.last_row && x >= 0 && x < sky.layout.edge
}

function is_on_typed(layout: ThemeLayout, y: number, x: number): boolean {
	const is_typed_row = y === layout.notice.y || y === layout.progress.y

	return is_typed_row && x >= layout.notice.x - NOTICE_LEAD && x <= layout.progress.end
}

function on_screen(sky: Sky, y: number, x: number): boolean {
	return is_in_screen(sky, y, x) && !is_on_typed(sky.layout, y, x)
}

function is_spot(sky: Sky, spot: Point): boolean {
	const { area_top, area_end } = sky.layout

	return on_screen(sky, spot.y, spot.x) && (spot.y < area_top || spot.y > area_end)
}

// A spot on the screen outside the area, off the notice and the progress line.
function screen_spot(sky: Sky, seed: number): Point {
	for (let attempt = 0; attempt < SPOT.attempts; attempt++) {
		const y = Math.floor(hash(seed, attempt, SALT.spot_y) * (sky.last_row + 1))
		const span = sky.layout.edge - SPOT.span
		const x = SPOT.margin + Math.floor(hash(seed, attempt, SALT.spot_x) * span)

		if (is_spot(sky, { y, x })) return { y, x }
	}

	return { y: 0, x: SPOT.margin }
}

function track_of(
	sky: Sky,
	war: number,
	length: number,
	at: { track: number; count: number },
): Track {
	const { track, count } = at
	const target = target_at(sky, war, track)
	const is_odd = track % PAIR === 1
	const site = is_odd ? near_site(sky, target, war, track) : land_at(sky, war * WAR_SEED + track)
	const from = Math.round(length * (TRACKS.launch + TRACKS.spread * (track / count)))
	const to = from + Math.max(1, Math.round(length / TRACKS.flight))
	const ink = TRACK_INKS[track % PAIR] ?? ''

	return { y0: site.y, x0: site.x, y1: target.y, x1: target.x, from, to, ink }
}

function war_of(sky: Sky, war: number, at: { start: number; length: number }): War {
	const { start, length } = at
	const count = Math.min(TRACKS.most, TRACKS.first + TRACKS.more * war)
	const tracks = Array.from({ length: count }, (_, track) =>
		track_of(sky, war, length, { track, count }),
	)
	const blobs = Array.from(
		{ length: Math.min(BLOBS.most, BLOBS.first + BLOBS.more * war) },
		(_, k) => ({
			...screen_spot(sky, war * WAR_SEED + k),
			from: Math.round(length * (BLOBS.from + BLOBS.spread * hash(war, k, SALT.bloom))),
		}),
	)

	return { start, length, tracks, blobs }
}

function wars_of(sky: Sky): Array<War> {
	let start = WAR_START

	return war_lengths().map((length, war) => {
		const each = war_of(sky, war, { start, length })

		start += length

		return each
	})
}

// The WINNER table's rows' ticks, from the wars' start up to the ending.
function table_at(): Array<number> {
	const ticks: Array<number> = []

	let tick = WAR_START

	while (tick < CLOSE_FROM) {
		const row = ticks.length

		ticks.push(tick)
		tick += Math.max(1, Math.round(TABLE_PACE.first * TABLE_PACE.ratio ** row))
	}

	return ticks
}

function war_at(wars: ReadonlyArray<War>, cooled: number): War | undefined {
	return wars.find((each) => cooled >= each.start && cooled < each.start + each.length)
}

function in_air(wars: ReadonlyArray<War>, cooled: number): number {
	const now = war_at(wars, cooled)

	if (!now) return 0
	const age = cooled - now.start

	return now.tracks.filter((track) => age >= track.from && age < track.to).length
}

function impacts(wars: ReadonlyArray<War>, cooled: number): number {
	return wars.reduce(
		(sum, each) => sum + each.tracks.filter((track) => cooled - each.start >= track.to).length,
		0,
	)
}

const run_board_theme_wopr_wars = {
	impacts,
	in_air,
	in_area,
	land_cells_of,
	on_screen,
	table_at,
	war_at,
	war_lengths,
	wars_of,
	white_ticks,
}

export { run_board_theme_wopr_wars }
export type { Blob, Sky, Track, War }
