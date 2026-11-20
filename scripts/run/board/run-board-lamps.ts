import { styleText } from 'node:util'
import { run_board_fit } from './run-board-fit'
import { run_board_labels, type Paint, type TextColor } from './run-board-labels'
import { run_board_spot } from './run-board-spot'

// The WOPR lamp panel of `run:board --theme wargames` (joshuafolkken/kit#8236): right of the throughput
// rows' NOW, a `■` every other column up to the section's rule, lit yellow on the `24h` row and red on
// the `7d` row, out at half the row's color, dimmed (the row's named color dimmed where the terminal has
// no 24-bit color).
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
// An out lamp is its row's color at half of each channel.
const OUT_DIVISOR = 2
type Shade = Exclude<Paint, TextColor>
const SHADES: ReadonlyArray<Shade> = [GAUGE_SHADES.yellow, GAUGE_SHADES.red]

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
	return SHADES[row % SHADES.length]
}

// `rgb` (`R;G;B`) with each channel halved, rounded.
function halved(rgb: string): string {
	return rgb
		.split(';')
		.map((channel) => Math.round(Number(channel) / OUT_DIVISOR))
		.join(';')
}

// `text` out in `shade`, dimmed: at half its color where the terminal draws 24-bit color, else in its
// named color.
function out_text(shade: Shade, text: string): string {
	const out = painted({ rgb: halved(shade.rgb), named: shade.named }, text)

	return styleText('dim', out, { validateStream: false })
}

// A lamp of the row at `row` (`0` the `24h`, `1` the `7d`) as drawn lit or out.
function lamp_text(row: number, is_on: boolean, text = LAMP_MARK): string {
	const shade = shade_of(row)
	const lit = painted(shade, text)

	if (is_on || shade === undefined) return lit

	return out_text(shade, text)
}

// Lamps are drawn only where stdout draws color — a `■` with none would never go out.
function is_colored(): boolean {
	return painted(shade_of(0), LAMP_MARK) !== LAMP_MARK
}

// Where the row at `row` starts its panel, out until the frame's lamps are placed.
function start_of(row: number): string {
	return lamp_text(row, false, LAMP_START)
}

// The text before a dropped panel's marker up to its last figure: the marker's color escapes hold no
// blank, so the line's last blank is the gap before them.
function dropped(before: string): string {
	return before.slice(0, before.lastIndexOf(' ')).trimEnd()
}

// The panel started in `line` run on to column `end`, each lamp a placeholder the spinner's turns write
// (`run-board-lamp-spots.ts`); a panel with no room for eight is dropped with the blanks before it.
function expanded(line: string, end: number): string {
	const index = line.indexOf(LAMP_START)

	if (index === -1) return line
	const before = line.slice(0, index)
	const count = count_of(end - run_board_fit.width_of(before))
	const panel = Array.from({ length: count }, () => LAMP).join(' ')
	const after = line.slice(index + LAMP_START.length)

	return count === 0 ? dropped(before) : `${before}${panel}${after}`
}

// The group and its place of the lamp at `index` along the row at `row`.
function place_of(row: number, index: number): { group: number; lamp: number } {
	const group = row * GROUPS_PER_ROW + Math.floor(index / GROUP_SIZE)

	return { group, lamp: index % GROUP_SIZE }
}

const run_board_lamps = {
	LAMP_TICK_MS,
	count_of,
	expanded,
	is_colored,
	is_lit,
	lamp_text,
	place_of,
	start_of,
}

export { run_board_lamps }
