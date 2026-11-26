import { styleText } from 'node:util'
import { run_board_fit } from './run-board-fit'
import { run_board_labels, type Paint, type TextColor } from './run-board-labels'
import { run_board_spot } from './run-board-spot'

// The lamp panel of a themed `run:board` (joshuafolkken/kit#8236): from two columns past the throughput
// rows' NOW, a `■` every other column up to the section's rule, on seven rows — the `24h` and `7d` rows,
// the blank line under them, the usage section's rule (joshuafolkken/kit#8702), its first two provider
// rows (joshuafolkken/kit#8277) and GitHub's row (joshuafolkken/kit#8695) — drawn out at half yellow,
// dimmed (named `yellow` dimmed where the terminal has no 24-bit color; joshuafolkken/kit#8305). The
// theme host lays its panel and area out by these lamps (`run-board-theme-layout.ts`; joshuafolkken/kit#8917).

const { LAMP, LAMP_MARK, LAMP_START } = run_board_spot
const { GAUGE_SHADES, painted } = run_board_labels
const GROUP_SIZE = 4
const FEWEST_LAMPS = 8
// A lamp and the blank after it.
const LAMP_PITCH = 2
// Each row's lamps are their own groups, numbered apart from the other row's.
const GROUPS_PER_ROW = 1000
// An out lamp is yellow at half of each channel, on every row.
const OUT_DIVISOR = 2
type Shade = Exclude<Paint, TextColor>
const { red, yellow } = GAUGE_SHADES
// The panel's rows from the top: the `24h` and `7d` rows (`0`, `1`), the blank line under them, the
// usage section's rule, its first two provider rows, then GitHub's.
const PANEL_ROWS = { gap: 2, rule: 3, first_usage: 4, second_usage: 5, github: 6 }
const SHADES: ReadonlyArray<Shade> = [yellow, yellow, yellow, red, red, yellow, red]

// Where a panel starts and the column its rule ends at.
interface PanelSpan {
	start: number
	end: number
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

// Lamps are drawn only where stdout draws color — a `■` with none would never go out.
function is_colored(): boolean {
	return painted(shade_of(0), LAMP_MARK) !== LAMP_MARK
}

// Where the row at `row` starts its panel, out until the frame's lamps are placed.
function start_of(row: number): string {
	return lamp_text(row, false, LAMP_START)
}

// A rule ended two columns before the panel's `start`, starting a panel there as the rows around it do
// (joshuafolkken/kit#8647) — in a theme that lamps the rule (joshuafolkken/kit#8702); its marker is out.
function rule_started(rule: string, start: number): string {
	let cut = ''

	for (const character of rule) {
		if (run_board_fit.width_of(`${cut}${character}`) > start - LAMP_PITCH) break
		cut += character
	}

	return `${cut}${start_of(PANEL_ROWS.rule)}`
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
	PANEL_ROWS,
	count_of,
	expanded,
	is_colored,
	lamp_text,
	place_of,
	rule_started,
	start_column,
	start_of,
}

export { run_board_lamps }
export type { PanelSpan }
