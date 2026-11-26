import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Channel } from './run-board-theme-host-types'
import { run_board_theme_nixie_data, type NixieDraw } from './run-board-theme-nixie-data'

// STEINS;GATE's D-mail window (joshuafolkken/kit#8917), ported from the confirmed theme demo: while
// a notice arrives the mail's window sits at the area's left edge, over the data, and its bytes come
// in as three rows of twelve, until the giant meter takes the area.

const { BOLD, bg, code_points, fg, put, repeated } = run_board_theme_host_grid
const { COLOR, GIANT_FROM, MAIL_BODY, MAIL_BYTES, MAIL_LINE, MAIL_W } = run_board_theme_nixie_data

// Where the window's parts sit: its left edge, the label and byte count row, the body rows, the bar.
// Rows as offsets from the area's top (joshuafolkken/kit#8917; the demo's area_top was 4).
const MAIL = { x: 1, head_y: 1, head_x: 3, count_back: 16, body_y: 3, body_x: 6, bar_y: 6 }
const MAIL_LINES = 3
// The title rule's corners, dash, label and spaces; the frame's sides; the bar's margins.
const TITLE_TRIM = 11
const SIDES = 2
const BAR_TRIM = 6
const COUNT_DIGITS = 2
const BLINK = { every: 4, lit: 2 }

interface Ink {
	ink: string
	dark: string
}

function bytes_of(notice: Channel): number {
	const share = notice.length / (notice.total * GIANT_FROM)

	return Math.min(MAIL_BYTES, Math.round(share * MAIL_BYTES))
}

function mail_frame(frame: NixieDraw, style: string): void {
	const { grid, api } = frame
	const { area_top, area_end } = api.layout

	put(grid, { y: area_top, x: MAIL.x }, `┌─ D-MAIL ${'─'.repeat(MAIL_W - TITLE_TRIM)}┐`, style)

	for (let y = area_top + 1; y < area_end; y++) {
		put(grid, { y, x: MAIL.x }, `│${' '.repeat(MAIL_W - SIDES)}│`, style)
	}

	put(grid, { y: area_end, x: MAIL.x }, `└${'─'.repeat(MAIL_W - SIDES)}┘`, style)
}

function mail_head(frame: NixieDraw, bytes: number, look: Ink): void {
	const { grid, state, tick } = frame
	const y = frame.api.layout.area_top + MAIL.head_y
	const plain = `${look.ink}${look.dark}`
	const label = state.notice.is_typing ? 'RECEIVING' : 'RECEIVED'
	const lit = `${fg(COLOR.mail_label)}${BOLD}${bg(COLOR.bolt)}`
	const count = `${String(bytes).padStart(COUNT_DIGITS, '0')}/${String(MAIL_BYTES)} BYTES`

	put(grid, { y, x: MAIL.head_x }, ` ${label} `, tick % BLINK.every < BLINK.lit ? lit : plain)
	put(grid, { y, x: MAIL.head_x + MAIL_W - MAIL.count_back }, count, plain)
}

function mail_line(line: number, bytes: number): string {
	const from = line * MAIL_LINE
	const shown = code_points(MAIL_BODY.slice(from, from + MAIL_LINE)).map((ch, index) =>
		from + index < bytes ? ch : '·',
	)

	return shown.join(' ')
}

function mail_body(frame: NixieDraw, bytes: number, look: Ink): void {
	const style = `${fg(COLOR.white)}${BOLD}${look.dark}`
	const top = frame.api.layout.area_top + MAIL.body_y

	for (let line = 0; line < MAIL_LINES; line++) {
		put(frame.grid, { y: top + line, x: MAIL.body_x }, mail_line(line, bytes), style)
	}
}

// A notice arriving: the mail's window sits at the area's left edge, over the data, and its bytes
// come in as three rows of twelve.
function mail(frame: NixieDraw): void {
	const { notice } = frame.state

	if (!notice.is_typing || notice.length / notice.total >= GIANT_FROM) return
	const look = { ink: `${fg(COLOR.bolt)}${BOLD}`, dark: bg(COLOR.mail_dark) }
	const bytes = bytes_of(notice)
	const bar = repeated('▮', Math.round((bytes / MAIL_BYTES) * (MAIL_W - BAR_TRIM)))

	mail_frame(frame, `${look.ink}${look.dark}`)
	mail_head(frame, bytes, look)
	mail_body(frame, bytes, look)
	put(
		frame.grid,
		{ y: frame.api.layout.area_top + MAIL.bar_y, x: MAIL.head_x },
		bar.padEnd(MAIL_W - BAR_TRIM, '▯'),
		`${look.ink}${look.dark}`,
	)
}

const run_board_theme_nixie_mail = { bytes_of, mail, mail_line }

export { run_board_theme_nixie_mail }
