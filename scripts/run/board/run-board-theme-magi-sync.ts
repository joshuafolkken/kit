import { issue_cite } from '#scripts/issue/issue-cite'
import { run_board_theme_host_fonts } from './run-board-theme-host-fonts'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_magi_data, type MagiKit } from './run-board-theme-magi-data'
import { run_board_theme_magi_draw } from './run-board-theme-magi-draw'
import { run_board_theme_magi_gauges } from './run-board-theme-magi-gauges'
import { run_board_theme_rules } from './run-board-theme-rules'

// The MAGI theme's ROW effect (joshuafolkken/kit#8917), ported from the confirmed theme demo: the
// synchronization display takes the area left of the panel — two waves falling into step, the
// borderline bar, the checks, the rate in tall digits.

const { big_number, big_width } = run_board_theme_host_fonts
const { plain_for } = issue_cite
const { BOLD, cells_bar, fg, pick, put, repeated } = run_board_theme_host_grid
const { active } = run_board_theme_host_state
const { AMBER, AMBER_BOLD, BLINK, CHECKS, EFFECT_TAIL, GREEN, GREEN_ON, ORANGE, PALE_BOLD } =
	run_board_theme_magi_data
const { SPINNER, WHITE } = run_board_theme_magi_data
const { retitled_lead } = run_board_theme_rules
const { is_lit } = run_board_theme_magi_draw
const { sync_rate } = run_board_theme_magi_gauges

const FULL = 100
// The waves: their first column, their spacing and speed; their top row is the limit's.
const WAVE = { x: 2, spacing: 0.3, speed: 0.4 }
// The title's columns: the dashes, the title, the rule after it.
const TITLE = { text: 6, rule: 28, rule_end: 29 }
// The borderline bar's label column, its bar's column and how much shorter than the display it is.
const BORDER = { x: 2, bar_x: 13, short: 13 }
// The checks' label column and width, their word's column.
const CHECK = { x: 2, width: 18, word: 21 }
// The tall rate on the low panels' row: its digits and their gap from the display's end, the percent
// sign two rows below, ALL GREEN.
const DIGITS = { places: 5, end_gap: 4, sign_below: 2, sign_gap: 2, green: 12 }

// Two waves a phase apart that fall into step as the rate climbs; where they meet they glow white.
function wave_column(
	grid: Grid,
	at: { x: number; top: number },
	tick: number,
	apart: number,
): void {
	const { x, top } = at
	const above = Math.round(1 + Math.sin(x * WAVE.spacing + tick * WAVE.speed))
	const below = Math.round(1 + Math.sin(x * WAVE.spacing + tick * WAVE.speed + apart))

	if (above === below) {
		put(grid, { y: top + above, x }, '◉', `${fg(WHITE)}${BOLD}`)

		return
	}

	put(grid, { y: top + above, x }, '●', `${fg('255;150;30')}${BOLD}`)
	put(grid, { y: top + below, x }, '○', `${fg('120;190;255')}${BOLD}`)
}

function sync_waves(kit: MagiKit, grid: Grid, rate: number, tick: number): void {
	const apart = (1 - rate / FULL) * Math.PI
	const top = kit.rows.limit

	for (let { x } = WAVE; x < kit.sync_w; x++) wave_column(grid, { x, top }, tick, apart)
}

// The area's rule retitled: its lead kept as the board has it (a live rule's fold marker), the title on
// the label's column and the rule after it moved with it (joshuafolkken/kit#8917).
function sync_title(kit: MagiKit, grid: Grid): void {
	const { area_top: y, new_lane } = kit.api.layout
	const shift = retitled_lead(grid, kit.api.board, { y, style: 'rule' }) - TITLE.text
	const title = `SYNCHRONIZATION ${plain_for('terminal', new_lane)} `

	put(grid, { y, x: TITLE.text + shift }, title, 'body')
	const rule = repeated('-', kit.sync_end - TITLE.rule_end - shift)

	put(grid, { y, x: TITLE.rule + shift }, rule, 'rule')
}

function borderline(kit: MagiKit, grid: Grid, rate: number): void {
	const bar = kit.sync_w - BORDER.short
	const cells = Math.round((rate / FULL) * bar)

	put(grid, { y: kit.rows.links, x: BORDER.x }, 'BORDERLINE ', ORANGE)
	const style = rate >= FULL ? GREEN : ORANGE

	put(grid, { y: kit.rows.links, x: BORDER.bar_x }, cells_bar(cells, bar), style)
}

// A check's result: its word once the rate passes it, a spinner until then.
function check_word(grid: Grid, y: number, word: string | undefined, tick: number): void {
	if (word !== undefined) {
		put(grid, { y, x: CHECK.word }, word, GREEN)

		return
	}

	put(
		grid,
		{ y, x: CHECK.word },
		pick(SPINNER, (tick % SPINNER.length) / SPINNER.length),
		PALE_BOLD,
	)
}

function sync_checks(kit: MagiKit, grid: Grid, rate: number, tick: number): void {
	for (const [row, { name, at, word }] of CHECKS.entries()) {
		const y = kit.rows.low + row

		put(grid, { y, x: CHECK.x }, `${name} `.padEnd(CHECK.width, '.'), ORANGE)
		check_word(grid, y, rate >= at ? word : undefined, tick)
	}
}

function sync_digits(kit: MagiKit, grid: Grid, rate: number, tick: number): void {
	const is_full = rate >= FULL
	const text = rate.toFixed(1).padStart(DIGITS.places, '0')
	const x = kit.sync_w - big_width(text) - DIGITS.end_gap
	const style = `${fg(is_full && is_lit(tick, BLINK.slow) ? WHITE : AMBER)}${BOLD}`

	const y = kit.rows.low

	big_number(grid, { y, x }, text, { style, ghost: fg('70;35;0') })
	put(grid, { y: y + DIGITS.sign_below, x: x + big_width(text) + DIGITS.sign_gap }, '%', AMBER_BOLD)
	if (!is_full) return
	put(grid, { y, x: x - DIGITS.green }, ' ALL GREEN ', is_lit(tick, BLINK.slow) ? GREEN_ON : GREEN)
}

// ROW: the synchronization display takes the area left of the panel.
function sync_display(kit: MagiKit, grid: Grid, state: ThemeState, tick: number): void {
	if (!active(state.row, EFFECT_TAIL)) return
	const rate = sync_rate(state, tick) ?? 0

	kit.api.clear_area(grid, 0, kit.sync_end)
	sync_title(kit, grid)
	sync_waves(kit, grid, rate, tick)
	borderline(kit, grid, rate)
	sync_checks(kit, grid, rate, tick)
	sync_digits(kit, grid, rate, tick)
}

const run_board_theme_magi_sync = { sync_display, sync_waves }

export { run_board_theme_magi_sync }
