import { run_board_header_defcon } from './run-board-header-defcon'
import type { Paint } from './run-board-labels'

// joshuafolkken/kit#8349: what each theme draws, one row per theme — a theme is added by adding its
// row, and the theme names the CLI and the worker accept are this table's keys.

interface IntroDefinition {
	// The line typed before the first frame, and the pauses after each letter and after the line.
	line: string
	letter_ms: number
	hold_ms: number
}

// The live board's effects (joshuafolkken/kit#8360): whether each row types as it appears, and whether
// the trill sounds while it types.
interface LiveDefinition {
	types_rows: boolean
	trill: boolean
}

interface ThemeDefinition {
	// The color the theme draws text no color is given in.
	paint: Paint
	intro: IntroDefinition
	// The alert field a screen's first line ends on, drawn from the level every theme shares
	// (`run-board-header-defcon.ts` → `level_of`), 1 the worst (joshuafolkken/kit#8358).
	alert: (level: number) => string
	// Whether a live board in the theme draws the lamp panel (`run-board-lamps.ts`;
	// joshuafolkken/kit#8359).
	lamps: boolean
	live: LiveDefinition
}

const THEME_DEFS = {
	wargames: {
		// The cyan of the film terminal's phosphor glyph core in 24-bit color, else the palette's own cyan.
		paint: { rgb: '62;236;225', named: 'cyan' },
		intro: { line: 'SHALL WE PLAY A GAME?', letter_ms: 50, hold_ms: 2000 },
		alert: run_board_header_defcon.field_of,
		lamps: true,
		live: { types_rows: true, trill: true },
	},
} as const satisfies Readonly<Record<string, ThemeDefinition>>

// A table's theme names, in its row order, as the non-empty list `z.enum` takes.
function names_of<Name extends string>(
	defs: Readonly<Record<Name, ThemeDefinition>>,
): [Name, ...Array<Name>] {
	const names = Object.keys(defs).filter((key): key is Name => Object.hasOwn(defs, key))
	const [first, ...rest] = names

	if (first === undefined) throw new Error('a theme table has no theme')

	return [first, ...rest]
}

const THEMES = names_of(THEME_DEFS)

type Theme = keyof typeof THEME_DEFS

const run_board_theme_defs = {
	THEMES,
	THEME_DEFS,
	names_of,
}

export { run_board_theme_defs }
export type { IntroDefinition, LiveDefinition, Theme, ThemeDefinition }
