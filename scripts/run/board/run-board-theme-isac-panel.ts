import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Point, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_isac_data } from './run-board-theme-isac-data'
import { run_board_theme_isac_field, type Field } from './run-board-theme-isac-field'

// The isac theme's panel. Idle: the network, the agents and an armor bar on the left, a framed
// scanner on the right whose ring runs out from the centre every three seconds, contacts glowing as
// it passes. PROGRESS: a voice transmission takes the panel — a waveform, brackets closing on it.

const { cells_bar } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { active } = run_board_theme_host_state
const { PAIR, panel_box, panel_pane, put_in, share_of } = run_board_theme_draw
const { INKS, SCAN, STATUS, TX } = run_board_theme_isac_data
const { field_distance, hex_field } = run_board_theme_isac_field

// A status row's words: its name, the mark after it and its value.
interface StatusWords {
	name: string
	mark: string
	value: string
}

// A PROGRESS plays: while its line types and a moment after.
function is_receiving(state: ThemeState): boolean {
	return active(state.progress, TX.linger)
}

function status_row(pane: Pane, y: number, words: StatusWords, mark_ink: string): void {
	put_in(pane, { x: 0, y }, words.name, INKS.DIM)
	put_in(pane, { x: STATUS.mark_x, y }, words.mark, mark_ink)
	put_in(pane, { x: STATUS.value_x, y }, words.value, INKS.ORANGE)
}

// The armor bar, one of its lit segments bright, the bright one walking along it.
function armor_bar(pane: Pane, tick: number): void {
	const y = STATUS.armor_row
	const bright = Math.floor(tick / STATUS.shimmer_pace) % STATUS.armor_lit

	put_in(pane, { x: 0, y }, 'ARMOR', INKS.DIM)
	put_in(
		pane,
		{ x: STATUS.mark_x, y },
		cells_bar(STATUS.armor_lit, STATUS.armor_cells),
		INKS.ORANGE,
	)
	put_in(pane, { x: STATUS.mark_x + bright, y }, '▮', INKS.BRIGHT)
}

function status_block(draw: ThemeDraw): void {
	const { api, s, tick } = draw
	const pane = panel_pane(draw)
	const agents = String(api.layout.lane_rows.length || STATUS.sample_agents)
	const lamp = tick % STATUS.blink < STATUS.blink_lit ? INKS.BRIGHT : INKS.ORANGE
	const uplink = { name: 'UPLINK', mark: '', value: s.busy ? 'ACTIVE' : 'STANDBY' }

	status_row(pane, STATUS.network_row, { name: 'NETWORK', mark: '●', value: 'ONLINE' }, lamp)
	status_row(pane, STATUS.agents_row, { name: 'AGENTS', mark: agents, value: 'ACTIVE' }, INKS.WHITE)
	armor_bar(pane, tick)
	status_row(pane, STATUS.uplink_row, uplink, INKS.DIM)
}

// A contact's place inside the scanner, fixed by its number.
function contact_at(inner: Pane, index: number): Point {
	return {
		x: Math.floor(hash(index, 1, SCAN.salt) * inner.box.w),
		y: Math.floor(hash(index, PAIR, SCAN.salt) * inner.box.h),
	}
}

// The contacts: dim, and white for a moment once the ring has passed them.
function contacts(inner: Pane, field: Field): void {
	for (let index = 0; index < SCAN.contacts; index++) {
		const at = contact_at(inner, index)
		const behind = field.reach - field_distance(at, field.center)

		put_in(inner, at, '◆', behind > 0 && behind < SCAN.glow ? INKS.WHITE : INKS.DIM)
	}
}

// The framed scanner: the dot field, one ring running out from its centre, the contacts.
function scanner(draw: ThemeDraw): void {
	const { api, grid, tick } = draw
	const box = panel_box(api.layout)
	const frame = { x: box.x + SCAN.x, y: box.y, w: SCAN.w, h: SCAN.h }
	const inside = { x: frame.x + 1, y: frame.y + 1, w: SCAN.w - PAIR, h: SCAN.h - PAIR }
	const center = { x: (inside.w - 1) / PAIR, y: (inside.h - 1) / PAIR }
	const field = { center, reach: (tick % SCAN.period) * SCAN.pace, lit: 0 }

	api.framed(grid, frame, SCAN.label, INKS.DIM)
	hex_field({ grid, box: inside }, field)
	contacts({ grid, box: inside }, field)
}

// A bar's height while the line types, held two ticks: none to twice the glyphs' count.
function wave_height(index: number, tick: number): number {
	const held = Math.floor(tick / TX.hold)

	return Math.floor(hash(index, held, TX.salt) * TX.levels.length * PAIR)
}

// The waveform on two rows: bars of every height while the line types, a flat line after.
function waveform(draw: ThemeDraw, pane: Pane): void {
	const { s, tick } = draw
	const full = TX.levels.length
	const heights = Array.from({ length: TX.wave_w }, (_, index) =>
		s.progress.is_typing ? wave_height(index, tick) : 0,
	)
	const upper = heights.map((height) => (height >= full ? TX.levels.charAt(height - full) : ' '))
	const lower = heights.map((height) => (height >= full ? '█' : TX.levels.charAt(height)))

	put_in(pane, { x: TX.wave_x, y: TX.wave_row }, upper.join(''), INKS.ORANGE)
	put_in(pane, { x: TX.wave_x, y: TX.wave_row + 1 }, lower.join(''), INKS.ORANGE)
}

// Bracket corners close in from the panel's ends to the waveform's.
function wave_brackets(draw: ThemeDraw, pane: Pane): void {
	const { s, tick } = draw
	const closing = share_of(tick, s.progress.start, TX.close_ticks)
	const left = Math.round((TX.wave_x - TX.gap) * closing)
	const right = TX.wave_x * PAIR + TX.wave_w - PAIR - left

	put_in(pane, { x: left, y: TX.top_row }, '┌─', INKS.BRIGHT)
	put_in(pane, { x: right, y: TX.top_row }, '─┐', INKS.BRIGHT)
	put_in(pane, { x: left, y: TX.bottom_row }, '└─', INKS.BRIGHT)
	put_in(pane, { x: right, y: TX.bottom_row }, '─┘', INKS.BRIGHT)
}

function transmission(draw: ThemeDraw): void {
	const { s, tick } = draw
	const pane = panel_pane(draw)
	const is_lit = tick % TX.blink < TX.blink_lit
	const at = { x: TX.wave_x, y: TX.label_row }

	if (s.progress.is_typing) {
		put_in(pane, at, 'INCOMING TRANSMISSION', is_lit ? INKS.BRIGHT : INKS.ORANGE)
	} else put_in(pane, at, 'TRANSMISSION RECEIVED', INKS.ORANGE)
	waveform(draw, pane)
	wave_brackets(draw, pane)
}

// The panel: the transmission through a PROGRESS, else the status block and the scanner.
function panel(draw: ThemeDraw): void {
	if (is_receiving(draw.s)) {
		transmission(draw)

		return
	}

	status_block(draw)
	scanner(draw)
}

const run_board_theme_isac_panel = { is_receiving, panel, wave_height }

export { run_board_theme_isac_panel }
