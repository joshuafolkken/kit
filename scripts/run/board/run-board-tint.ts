import { run_board_labels, type Paint } from './run-board-labels'
import {
	run_board_theme_defs,
	type PlainLook,
	type Theme,
	type ThemeDefinition,
} from './run-board-theme-defs'
import { run_board_theme_glyphs } from './run-board-theme-glyphs'

// A color laid over text a render module gave no color: the theme's own over a whole line
// (`run-board-theme.ts`), and joshuafolkken/kit#8673's time circuits over the header's clock rows — a
// color the frame gave is kept, the tint resumed after it.

const DASH = '-'
const RULE = '─'
const RULE_RUN = /(─+)/u
// The escapes that end a color and fall back to the terminal's default foreground: the default
// foreground itself, and a reset.
const DEFAULT_FOREGROUND = '\u{1B}[39m'
const RESET = '\u{1B}[0m'
const DIM_OPEN = '\u{1B}[2m'
const INTENSITY_OFF = '\u{1B}[22m'
const { THEME_DEFS } = run_board_theme_defs

// The escape that opens `paint`, as `painted` draws it — `''` where stdout draws no color, so a tint
// draws no escape where the board's own colors would not.
function open_of(paint: Paint): string {
	const sample = run_board_labels.painted(paint, DASH)

	return sample.slice(0, sample.indexOf(DASH))
}

// `line` with `open` over every part no color is given, the default foreground after it.
function lit(open: string, line: string): string {
	if (open === '' || line === '') return line

	const resumed = line
		.split(DEFAULT_FOREGROUND)
		.join(open)
		.split(RESET)
		.join(RESET + open)

	return open + resumed + DEFAULT_FOREGROUND
}

function definition_of(theme: Theme | undefined): ThemeDefinition | undefined {
	return theme === undefined ? undefined : THEME_DEFS[theme]
}

// The header's clock rows' cells, each in its row's circuit where the theme has circuits.
function circuit_cells(theme: Theme | undefined, cells: ReadonlyArray<string>): Array<string> {
	const circuits = definition_of(theme)?.circuits

	if (circuits === undefined) return [...cells]

	return cells.map((cell, row) => {
		const paint = circuits[row]

		return paint === undefined ? cell : lit(open_of(paint), cell)
	})
}

// What text no color is given in is drawn with: the theme's plain look and its rules' paint.
interface PlainPaints extends PlainLook {
	rule: Paint
}

// `text` in `paint` with the bold or dim off, so its color shows as given; `intensity` after it.
function lit_part(paint: Paint, text: string, intensity: string): string {
	const drawn = run_board_labels.painted(paint, text)

	return intensity === '' ? drawn : `${INTENSITY_OFF}${drawn}${intensity}`
}

function plain_part(paints: PlainPaints, part: string, intensity: string): string {
	if (part.startsWith(RULE)) return lit_part(paints.rule, part, intensity)

	return intensity.includes(DIM_OPEN) ? lit_part(paints.dim, part, intensity) : part
}

// Text no color is given in: each run of rule glyphs in the rule paint, dim text in the dim paint in
// place of the dim attribute; the bold or dim the line had on is restored after each.
function plain_drawn(paints: PlainPaints, line: string): string {
	return run_board_theme_glyphs.mapped(line, (text, open) => {
		if (open.is_colored) return text
		const parts = text.split(RULE_RUN).filter((part) => part !== '')

		return parts.map((part) => plain_part(paints, part, open.intensity)).join('')
	})
}

const run_board_tint = { circuit_cells, lit, open_of, plain_drawn }

export { run_board_tint }
