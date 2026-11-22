import { styleText } from 'node:util'
import { run_board_fit } from './run-board-fit'
import { run_board_labels, type Paint, type TextColor } from './run-board-labels'
import { run_board_spot } from './run-board-spot'

// The WOPR lamp panel of `run:board --theme wargames` (joshuafolkken/kit#8236): from two columns past the
// throughput rows' NOW, a `■` every other column up to the section's rule, on six rows — the `24h` and
// `7d` rows, the blank line under them, the usage section's first two provider rows
// (joshuafolkken/kit#8277) and GitHub's row (joshuafolkken/kit#8695) — lit yellow, yellow, red, yellow,
// red, yellow from the top, out on every row at half
// yellow, dimmed (named `yellow` dimmed where the terminal has no 24-bit color; joshuafolkken/kit#8305).
// Lamps blink four to a group, each group on its own period and phase, about four in ten lit; whether
// one is lit is read off the moment, its group and its place alone.

const { LAMP, LAMP_MARK, LAMP_START } = run_board_spot
const { GAUGE_SHADES, SPINNER_INTERVAL_MS, painted } = run_board_labels
// The lamps change on the spinner's step.
const LAMP_TICK_MS = SPINNER_INTERVAL_MS
const GROUP_SIZE = 4
// A group's period in steps, within the range joshuafolkken/kit#8236 set.
const LEAST_PERIOD_STEPS = 3
const PERIOD_SPAN_STEPS = 16
const PERCENT = 100
const LIT_PERCENT = 40
const FEWEST_LAMPS = 8
// A lamp and the blank after it.
const LAMP_PITCH = 2
// Each row's lamps are their own groups, numbered apart from the other row's.
const GROUPS_PER_ROW = 1000
const PERIOD_SALT = 1
const PHASE_SALT = 2
// The Park–Miller generator's multiplier and prime modulus, stepped once per value and twice more after.
const MIX_MULTIPLIER = 48_271
const MIX_MODULUS = 2_147_483_647
const MIX_SEED = 1
// An out lamp is yellow at half of each channel, on every row.
const OUT_DIVISOR = 2
type Shade = Exclude<Paint, TextColor>
const { red, yellow } = GAUGE_SHADES
// The panel's rows from the top: the `24h` and `7d` rows (`0`, `1`), the blank line under them, and the
// usage section's first two provider rows, then GitHub's.
const PANEL_ROWS = { gap: 2, first_usage: 3, second_usage: 4, github: 5 }
const SHADES: ReadonlyArray<Shade> = [yellow, yellow, red, yellow, red, yellow]

// Where a panel starts and the column its rule ends at.
interface PanelSpan {
	start: number
	end: number
}

function mix_step(state: number, value: number): number {
	return ((state + value) * MIX_MULTIPLIER) % MIX_MODULUS
}

// The values mixed into one number in `0`..`MIX_MODULUS`, the same for the same values.
function mixed(values: ReadonlyArray<number>): number {
	let state = MIX_SEED

	for (const value of [...values, 0, 0]) state = mix_step(state, value)

	return state
}

// The step a group's pattern is on at `now_ms`; in a burst every group changes on every step.
function epoch_of(now_ms: number, group: number, is_burst: boolean): number {
	const step = Math.floor(now_ms / LAMP_TICK_MS)

	if (is_burst) return step
	const period = LEAST_PERIOD_STEPS + (mixed([group, PERIOD_SALT]) % PERIOD_SPAN_STEPS)
	const phase = mixed([group, PHASE_SALT]) % period

	return Math.floor((step + phase) / period)
}

function is_lit(now_ms: number, group: number, lamp: number, is_burst: boolean): boolean {
	return mixed([group, epoch_of(now_ms, group, is_burst), lamp]) % PERCENT < LIT_PERCENT
}

// The lamps a `width`-column panel holds, one every other column; none where fewer than eight fit.
function count_of(width: number): number {
	const count = Math.floor((width + 1) / LAMP_PITCH)

	return count < FEWEST_LAMPS ? 0 : count
}

function shade_of(row: number): Shade | undefined {
	return SHADES[row]
}

// `rgb` (`R;G;B`) with each channel halved, rounded.
function halved(rgb: string): string {
	return rgb
		.split(';')
		.map((channel) => Math.round(Number(channel) / OUT_DIVISOR))
		.join(';')
}

// Every row's out lamp: yellow at half of each channel, its named color where the terminal has no 24-bit
// color (joshuafolkken/kit#8305).
const OUT_SHADE: Shade = { rgb: halved(yellow.rgb), named: yellow.named }

// `text` out, dimmed, in `OUT_SHADE` whatever its row's color.
function out_text(text: string): string {
	return styleText('dim', painted(OUT_SHADE, text), { validateStream: false })
}

// A lamp of the panel's row at `row` (`PANEL_ROWS`) as drawn lit or out.
function lamp_text(row: number, is_on: boolean, text = LAMP_MARK): string {
	const shade = shade_of(row)

	if (is_on || shade === undefined) return painted(shade, text)

	return out_text(text)
}

// How a lamp outside the panel is lit: in the panel's yellow or red, or out as the panel's are
// (joshuafolkken/kit#8376).
type LampLook = 'yellow' | 'red' | 'out'

function look_text(look: LampLook): string {
	if (look === 'out') return out_text(LAMP_MARK)

	return painted(look === 'red' ? red : yellow, LAMP_MARK)
}

// Lamps are drawn only where stdout draws color — a `■` with none would never go out.
function is_colored(): boolean {
	return painted(shade_of(0), LAMP_MARK) !== LAMP_MARK
}

// Where the row at `row` starts its panel, out until the frame's lamps are placed.
function start_of(row: number): string {
	return lamp_text(row, false, LAMP_START)
}

// A rule ended two columns before the panel's `start`, starting a panel there as the rows around it do
// (joshuafolkken/kit#8647); its marker is out in the blank line's shade, a rain frame's only.
function rule_started(rule: string, start: number): string {
	let cut = ''

	for (const character of rule) {
		if (run_board_fit.width_of(`${cut}${character}`) > start - LAMP_PITCH) break
		cut += character
	}

	return `${cut}${start_of(PANEL_ROWS.gap)}`
}

// The text before a dropped panel's marker up to its last figure: the marker's color escapes hold no
// blank, so the line's last blank is the gap before them.
function dropped(before: string): string {
	return before.slice(0, before.lastIndexOf(' ')).trimEnd()
}

// The column the panel started in `line` starts at, none where it starts none.
function start_column(line: string): number | undefined {
	const index = line.indexOf(LAMP_START)

	return index === -1 ? undefined : run_board_fit.width_of(line.slice(0, index))
}

// The panel started in `line` moved out to `span.start` and run on to its `end`, each lamp a placeholder
// the spinner's turns write (`run-board-lamp-spots.ts`); a panel with no room for eight is dropped with
// the blanks before it.
function expanded(line: string, span: PanelSpan): string {
	const index = line.indexOf(LAMP_START)

	if (index === -1) return line
	const before = line.slice(0, index)
	const lead = ' '.repeat(Math.max(0, span.start - run_board_fit.width_of(before)))
	const count = count_of(span.end - run_board_fit.width_of(before) - lead.length)
	const panel = Array.from({ length: count }, () => LAMP).join(' ')
	const after = line.slice(index + LAMP_START.length)

	return count === 0 ? dropped(before) : `${before}${lead}${panel}${after}`
}

// The group and its place of the lamp at `index` along the row at `row`.
function place_of(row: number, index: number): { group: number; lamp: number } {
	const group = row * GROUPS_PER_ROW + Math.floor(index / GROUP_SIZE)

	return { group, lamp: index % GROUP_SIZE }
}

const run_board_lamps = {
	LAMP_TICK_MS,
	PANEL_ROWS,
	count_of,
	expanded,
	is_colored,
	is_lit,
	lamp_text,
	look_text,
	mixed,
	place_of,
	rule_started,
	start_column,
	start_of,
}

export { run_board_lamps }
export type { LampLook, PanelSpan }
