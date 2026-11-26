import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_parts } from './run-board-theme-host-parts'
import { run_board_theme_host_settle } from './run-board-theme-host-settle'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type {
	Cell,
	Channel,
	FinalCell,
	FinalGrid,
	Grid,
	PartName,
	Point,
	ThemeApi,
	ThemeColors,
	ThemeLayout,
	ThemeModule,
	ThemePart,
	ThemeState,
	ThemeTimeline,
} from './run-board-theme-host-types'

// The theme host's frame (joshuafolkken/kit#8917), ported from the confirmed theme demo: the board
// with the typed text laid in, named and cased for the theme, its spinner turning, drawn on by the
// theme, its header colons blinking, an opening or ending over it, and every cell's style finished.

const { BOLD, DIM, ESC, bg, cell_at, code_points, fg, in_capitals, put, row_of, set_cell } =
	run_board_theme_host_grid
const { TICK_MS, state_of } = run_board_theme_host_state
const { plain_ending, plain_opening } = run_board_theme_host_parts
const { settle_progress } = run_board_theme_host_settle

// The spinner keeps kit's own ten-frame cycle and pace, mapping its frame onto the theme's glyphs.
const SPINNER_MS = 80
const SPINNER_CYCLE = 10
const SPINNERS: ReadonlyMap<string, string> = new Map([
	['WARGAMES', '│╱─╲'],
	['BTTF', '│╱─╲'],
	['MATRIX', 'ｦｱｳｴｵｶｷｹｺｻ'],
	['METAL GEAR', '▁▂▃▅▇█▇▅▃▂'],
	['STEINS;GATE', '0123456789'],
	['TERMINATOR', '▖▘▝▗'],
	['MAGI', '┤┘┴└├┌┬┐'],
])
// The header's third row carries the signs column's spinner.
const SIGN_ROW = 2
// The header clocks' colons: lit half a second, dark half a second.
const COLON_MS = 500
const COLON_PHASES = 2
// The board's name, top left; kit's own names for the themes it has.
const BOARD_NAMES: ReadonlyMap<string, string> = new Map([
	['BTTF', 'josh-flux'],
	['MATRIX', 'josh-trace'],
	['WARGAMES', 'josh-wopr'],
])
const NAME_AT = { y: 0, x: 2, w: 14 }
// The progress line's icon sits three cells before its words; a typed lane's newest three cells glow.
const ICON_BACK = 3
const TYPE_TAIL = 3
// A wash's color is rounded to steps of six in each channel, so adjacent cells share it more often.
const WASH_STEP = 6
const COLOR_MAX = 255
// A role key is a role and at most one attribute ('body', 'rule:dim').
const KEY_PARTS = 2
const IDLE: ThemeTimeline = { notice: [], progress: [], row: [] }

// The typed text over its span; the rest of the span blank.
function lay_text(grid: Grid, typed: Channel, role: string): void {
	if (typed.index < 0) return
	const { y, x, end } = typed.span
	const cursor = typed.is_typing ? '█' : ''

	grid[y]?.splice(
		x,
		end - x,
		...row_of(`${typed.text.slice(0, typed.length)}${cursor}`, role, end - x),
	)
	if (typed.icon) put(grid, { y, x: x - ICON_BACK }, `${typed.icon} `, role)
}

function type_row(row: Array<Cell>, x: number, shown: number): void {
	for (let at = Math.max(x, shown - TYPE_TAIL); at < shown; at++) {
		row[at] = [row[at]?.[0] ?? ' ', 'type']
	}

	row[shown] = ['█', 'type']
}

// A lane added: the frame's own row shows as far as it has typed, its newest cells in the typing color.
function lay_row(grid: Grid, layout: ThemeLayout, state: ThemeState): void {
	const row = grid[layout.row.y]

	if (!row || state.event.row.length === 0) return
	const shown = layout.row.x + state.row.length

	for (let at = shown; at < layout.w; at++) row[at] = [' ', 'body']
	if (state.row.is_typing) type_row(row, layout.row.x, shown)
}

function grid_of(api: ThemeApi, state: ThemeState): Grid {
	const grid = api.board.map((row) => [...row])

	lay_text(grid, state.notice_text, 'notice')
	lay_text(grid, state.progress, 'type')
	lay_row(grid, api.layout, state)

	return grid
}

function is_blank(cell: Cell | undefined): boolean {
	return cell === undefined || cell[0].trim() === ''
}

// The columns the base's own name holds: from its first cell to a blank before the clocks beside it,
// at most the name field's width — none past the row's end.
function name_room(row: ReadonlyArray<Cell>): number {
	const field = Array.from({ length: NAME_AT.w }, (_, index) => is_blank(row[NAME_AT.x + index]))
	const gap = field.indexOf(true)
	const next = gap === -1 ? -1 : field.indexOf(false, gap)

	return next === -1 ? NAME_AT.w : next - 1
}

// The name blanked on to its field's width, kept within the header's left column (joshuafolkken/kit#8917)
// so a narrow column — a single run's short name — never has it run over the clocks beside it.
function board_name(grid: Grid, theme: ThemeModule): void {
	const name = theme.board ?? BOARD_NAMES.get(theme.name) ?? 'josh'
	const width = Math.max(name.length, name_room(grid[NAME_AT.y] ?? []))

	put(grid, { y: NAME_AT.y, x: NAME_AT.x }, name.padEnd(width))
}

function spinner_frame(glyphs: string, tick: number): string {
	const turn = Math.floor((tick * TICK_MS) / SPINNER_MS) % SPINNER_CYCLE
	const frames = code_points(glyphs)

	return frames[Math.floor((turn * frames.length) / SPINNER_CYCLE)] ?? ''
}

// The first cell of each running lane; the lane a ROW adds turns only once it arrives.
function lane_spinners(grid: Grid, layout: ThemeLayout, state: ThemeState, frame: string): void {
	const is_coming = state.event.row.length > 0 && state.row.index < 0

	for (const y of layout.lane_spin_rows) {
		if (!is_coming || y !== layout.row.y) {
			set_cell(grid, { y, x: layout.lane_spin_x }, [frame, 'body'])
		}
	}
}

// kit's spinners off the signs column and the lanes, in the theme's glyphs too; a spot past the board's
// cells is left alone, so no row is grown with a hole in it.
function other_spinners(grid: Grid, layout: ThemeLayout, frame: string): void {
	const spins = (layout.other_spins ?? []).filter((at) => grid[at.y]?.[at.x] !== undefined)

	for (const at of spins) set_cell(grid, at, [frame, 'body'])
}

// Laid before the theme draws, so an effect that takes those cells covers it.
function lay_spinner(grid: Grid, layout: ThemeLayout, theme: ThemeModule, state: ThemeState): void {
	const glyphs = theme.spinner ?? SPINNERS.get(theme.name)

	if (!glyphs) return
	const frame = spinner_frame(glyphs, state.tick)

	if (layout.sign_x >= 0) set_cell(grid, { y: SIGN_ROW, x: layout.sign_x }, [frame, 'body'])
	lane_spinners(grid, layout, state, frame)
	other_spinners(grid, layout, frame)
}

function is_colon_dark(tick: number): boolean {
	return Math.floor((tick * TICK_MS) / COLON_MS) % COLON_PHASES === 1
}

// A colon an effect has repainted is left alone.
function dim_colon(grid: Grid, at: Point): void {
	const [ch, style] = cell_at(grid, at.y, at.x)

	if (ch === ':' && style === 'body') set_cell(grid, at, [':', 'body:dim'])
}

function blink_colons(grid: Grid, layout: ThemeLayout, theme: ThemeModule, tick: number): void {
	if (!theme.colons || !is_colon_dark(tick)) return

	for (const at of layout.head_colons) dim_colon(grid, at)
}

function color_of(colors: ThemeColors, role: string): string {
	const named: Readonly<Partial<Record<string, string>>> = colors

	return named[role] ?? colors.body
}

// A role key's SGR: the theme's color for the role (its body color for an unknown one), dim or bold.
function role_style(colors: ThemeColors, key: string): string {
	const [role = '', attribute] = key.split(':', KEY_PARTS)
	const color = fg(color_of(colors, role))

	if (attribute === 'dim') return `${color}${DIM}`

	return attribute === 'bold' ? `${color}${BOLD}` : color
}

function step_value(value: string): string {
	const level = Math.round(Number(value) / WASH_STEP) * WASH_STEP

	return String(Math.min(COLOR_MAX, level))
}

// Each channel of 'r;g;b' rounded to the nearest step, capped at full.
function stepped(color: string): string {
	return color.replaceAll(/\d+/gu, (value) => step_value(value))
}

// A cell's painted style, and the theme's wash behind it where the style sets no background of its own.
function final_cell(
	theme: ThemeModule,
	state: ThemeState,
	at: Point,
	[ch, style]: Cell,
): FinalCell {
	const painted = style.startsWith(ESC) ? style : role_style(theme.colors, style)

	if (!theme.background || painted.includes('48;2;')) return [ch, painted, '']
	const behind = theme.background(at.x, at.y, state.tick, state)

	return [ch, painted, behind ? stepped(behind) : '']
}

function finalize(grid: Grid, theme: ThemeModule, state: ThemeState): FinalGrid {
	return grid.map((row, y) => row.map((cell, x) => final_cell(theme, state, { x, y }, cell)))
}

// The board as the theme draws it at `tick`, before an opening or ending and before styles finish.
function drawn(
	theme: ThemeModule,
	api: ThemeApi,
	timeline: ThemeTimeline,
	tick: number,
): { grid: Grid; state: ThemeState } {
	const state = state_of(api.layout, timeline, tick)
	const grid = grid_of(api, state)

	board_name(grid, theme)
	if (theme.capitals) in_capitals(grid)
	lay_spinner(grid, api.layout, theme, state)
	theme.draw(grid, state, tick)
	settle_progress({ grid, api, state }, theme.colors)
	blink_colons(grid, api.layout, theme, tick)

	return { grid, state }
}

// A frame of `timeline` at `tick`: every cell as [character, painted SGR, background 'r;g;b' or ''].
function frame_of(
	theme: ThemeModule,
	api: ThemeApi,
	timeline: ThemeTimeline,
	tick: number,
): FinalGrid {
	const { grid, state } = drawn(theme, api, timeline, tick)

	return finalize(grid, theme, state)
}

// The opening or ending a theme plays: its own, or the host's plain one.
function part_of(theme: ThemeModule, layout: ThemeLayout, name: PartName): ThemePart {
	const own = theme[name]

	if (own) return own

	return name === 'opening' ? plain_opening(theme.name, layout) : plain_ending(theme.name, layout)
}

// A frame of the theme's opening or ending at `tick`, drawn over its idle board.
function part_frame_of(theme: ThemeModule, api: ThemeApi, name: PartName, tick: number): FinalGrid {
	const { grid, state } = drawn(theme, api, IDLE, tick)

	part_of(theme, api.layout, name).draw(grid, tick, state)

	return finalize(grid, theme, state)
}

// A finished cell's whole SGR: its painted style, then its wash's background last, so a change of
// wash alone shows as a change at the end of the sequence.
function sgr_of([, painted, behind]: FinalCell): string {
	return behind ? `${painted}${bg(behind)}` : painted
}

const run_board_theme_host_frame = {
	blink_colons,
	finalize,
	frame_of,
	lay_spinner,
	part_frame_of,
	part_of,
	role_style,
	sgr_of,
	spinner_frame,
	stepped,
}

export { run_board_theme_host_frame }
