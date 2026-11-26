import { issue_cite } from '#scripts/issue/issue-cite'
import type { Codec, Paint } from './run-board-theme-codec-context'
import { run_board_theme_codec_data } from './run-board-theme-codec-data'
import { run_board_theme_codec_radar } from './run-board-theme-codec-radar'
import { run_board_theme_host_fonts } from './run-board-theme-host-fonts'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Grid } from './run-board-theme-host-types'

// The codec theme's field display (joshuafolkken/kit#8917), ported from the confirmed theme demo:
// ROW takes the area — LIFE and two equipment boxes on the left, the mission log typing in the
// middle, and the radar on the right with the new contact pinging on it.

const { BOLD, cells_bar, centered, framed, put, repeated } = run_board_theme_host_grid
const { big_digit, big_number } = run_board_theme_host_fonts
const { STYLE, life_color } = run_board_theme_codec_data
const { radar } = run_board_theme_codec_radar

const BLINK = { every: 4, lit: 2 }
const STEP = { at: 14, glow: 26 }
const LIFE_ROW = { label_x: 1, bar_x: 6, w: 29 }
// The boxes' rows count from the area's rule (joshuafolkken/kit#8917: the demo's rows 6, 7 and 10).
const LANES_BOX = { x: 1, y: 2, w: 13, h: 6, digit_x: 6, digit_y: 3, tag_x: 3, tag_y: 6 }
const PICKED_BOX = { x: 15, y: 2, w: 20, h: 6, number_x: 18, number_y: 3, tag_x: 17, tag_y: 6 }
const PICKED_TAG_W = 16

function is_blink(tick: number): boolean {
	return tick % BLINK.every < BLINK.lit
}

function lanes_tag(paint: Paint, top: number, is_stepped: boolean): void {
	const tag_at = { y: top + LANES_BOX.tag_y, x: LANES_BOX.tag_x }

	if (is_stepped) put(paint.grid, tag_at, ' IN USE ', STYLE.on_green)
	else put(paint.grid, tag_at, ' ······ ', STYLE.green_dim)
}

// The count of lanes, which steps up as the new one arrives.
function lanes_box(codec: Codec, paint: Paint, age: number): void {
	const { grid, tick } = paint
	const is_stepped = age >= STEP.at
	const { area_top: top, lane_rows } = codec.layout
	const count = Math.max(0, lane_rows.length - (is_stepped ? 0 : 1))
	const is_glow = is_stepped && age < STEP.glow && is_blink(tick)
	const digit_at = { y: top + LANES_BOX.digit_y, x: LANES_BOX.digit_x }

	framed(grid, { ...LANES_BOX, y: top + LANES_BOX.y }, 'LANES', STYLE.frame)
	big_digit(grid, digit_at, String(count), { style: is_glow ? STYLE.white : STYLE.green_bold })
	lanes_tag(paint, top, is_stepped)
}

// The lane picked up: its number, its stage.
function picked_box(codec: Codec, paint: Paint, age: number): void {
	const { grid, tick } = paint
	const { new_lane, area_top: top } = codec.layout
	const style = age < STEP.glow && is_blink(tick) ? STYLE.yellow : STYLE.frame
	const tag = centered(
		`${issue_cite.plain_for('terminal', new_lane)} · ${codec.lane.stage}`,
		PICKED_TAG_W,
	)

	framed(grid, { ...PICKED_BOX, y: top + PICKED_BOX.y }, 'PICKED UP', style)
	big_number(grid, { y: top + PICKED_BOX.number_y, x: PICKED_BOX.number_x }, new_lane, {
		style: STYLE.yellow,
	})
	put(grid, { y: top + PICKED_BOX.tag_y, x: PICKED_BOX.tag_x }, tag, STYLE.pale_bold)
}

// The field display's left: the LIFE bar over two equipment boxes.
function equipment(codec: Codec, paint: Paint): void {
	const { grid, s, tick } = paint
	const age = tick - s.row.start
	const y = codec.layout.area_top

	put(grid, { y, x: LIFE_ROW.label_x }, 'LIFE', `${STYLE.body}${BOLD}`)
	put(grid, { y, x: LIFE_ROW.bar_x }, '█'.repeat(LIFE_ROW.w), life_color(tick))
	lanes_box(codec, paint, age)
	picked_box(codec, paint, age)
}

// The log's and the link's rows count from the area's rule (joshuafolkken/kit#8917: the demo's 5, 10).
const LOG = { x: 38, gap: 2, title: 15, first_y: 1, delay: 4, spacing: 16, value_x: 13 }
const LINK = { y: 6, trim: 20, percent: 100, digits: 3, blink: 6, lit: 3 }

// Log line `index`, on row `y`.
function log_line(
	paint: Paint,
	entry: [string, string],
	{ index, y }: { index: number; y: number },
): void {
	const [name, value] = entry
	const shown = Math.max(0, paint.tick - paint.s.row.start - LOG.delay - index * LOG.spacing)

	if (shown === 0) return
	const is_typing = shown < value.length
	const text = `${value.slice(0, shown)}${is_typing ? '█' : ''}`

	put(paint.grid, { y, x: LOG.x }, `> ${name}`.padEnd(LOG.value_x), STYLE.log_name)
	put(paint.grid, { y, x: LOG.x + LOG.value_x }, text, is_typing ? STYLE.pale_bold : STYLE.body)
}

function lane_secured(codec: Codec, grid: Grid, tick: number): void {
	const style = tick % LINK.blink < LINK.lit ? STYLE.on_green : STYLE.green_bold

	put(grid, { y: codec.layout.area_end, x: LOG.x }, ' LANE SECURED ', style)
}

// The link's progress: how much of the new lane's row has typed.
function link_bar(codec: Codec, paint: Paint, width: number): void {
	const { grid, s, tick } = paint
	const link = s.row.total ? s.row.length / s.row.total : 0
	const cells = Math.round(link * (width - LINK.trim))
	const percent = String(Math.round(link * LINK.percent)).padStart(LINK.digits)
	const bar = `${cells_bar(cells, width - LINK.trim)} ${percent}%`
	const is_secured = link >= 1

	const y = codec.layout.area_top + LINK.y

	put(grid, { y, x: LOG.x }, '> LINK', STYLE.log_name)
	put(grid, { y, x: LOG.x + LOG.value_x }, bar, is_secured ? STYLE.pale_bold : STYLE.yellow)
	if (is_secured) lane_secured(codec, grid, tick)
}

// The field display's middle: the mission log, a line typed at a time, and the link's progress.
function mission_log(codec: Codec, paint: Paint): void {
	const width = codec.side_radar.x - LOG.x - LOG.gap
	const title = `── MISSION LOG ${repeated('─', width - LOG.title)}`

	put(paint.grid, { y: codec.layout.area_top, x: LOG.x }, title, STYLE.frame)

	for (const [index, entry] of codec.log_lines.entries()) {
		log_line(paint, entry, { index, y: codec.layout.area_top + LOG.first_y + index })
	}

	link_bar(codec, paint, width)
}

const CONTACT_SHARE = 0.74
const QUERY_ROW = 2

// ROW takes the area as a field display: equipment on the left, the mission log in the middle,
// and the radar on the right with the new contact pinging on it.
function contact_screen(codec: Codec, paint: Paint): void {
	const { grid, tick } = paint
	const box = codec.side_radar
	const cx = box.x + 1 + Math.round((box.w - QUERY_ROW) * CONTACT_SHARE)
	const style = is_blink(tick) ? STYLE.query : STYLE.yellow

	codec.api.clear_area(grid)
	equipment(codec, paint)
	mission_log(codec, paint)
	radar(codec, paint, box, { jam: 0, is_contact: true, frame: '255;210;60' })
	put(grid, { y: box.y + QUERY_ROW, x: cx - 1 }, ' ? ', style)
}

const run_board_theme_codec_field = { contact_screen }

export { run_board_theme_codec_field }
