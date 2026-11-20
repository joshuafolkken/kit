import { run_board_header_defcon } from './run-board-header-defcon'
import { run_board_header_trace } from './run-board-header-trace'
import type { Paint } from './run-board-labels'
import { run_board_theme_tones } from './run-board-theme-tones'

// joshuafolkken/kit#8349: what each theme draws, one row per theme — a theme is added by adding its
// row, and the theme names the CLI and the worker accept are this table's keys.

interface IntroDefinition {
	// The line typed before the first frame, and the pauses after each letter and after the line.
	line: string
	letter_ms: number
	hold_ms: number
}

// The live board's effects (joshuafolkken/kit#8360): whether each row types as it appears, and whether
// the trill sounds while it types, and whether the section rules run launch codes while it types where
// the lamp panel shows (`run-board-codes.ts`; joshuafolkken/kit#8375), and whether a lamp strip fills
// above each rule by typing progress where the rules run code (`run-board-strip.ts`; joshuafolkken/kit#8376)
// — off in every theme for now, kept to switch back on (joshuafolkken/kit#8398).
interface LiveDefinition {
	types_rows: boolean
	trill: boolean
	codes: boolean
	strip: boolean
}

interface ThemeDefinition {
	// The color the theme draws text no color is given in.
	paint: Paint
	// The color of a section rule's `─`, where it is not the text's (joshuafolkken/kit#8397).
	rule?: Paint
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
		// The rules in the idle tone, behind the row typing (joshuafolkken/kit#8397).
		rule: run_board_theme_tones.IDLE_PAINT,
		intro: { line: 'SHALL WE PLAY A GAME?', letter_ms: 50, hold_ms: 2000 },
		alert: run_board_header_defcon.field_of,
		lamps: true,
		live: { types_rows: true, trill: true, codes: true, strip: false },
	},
	// joshuafolkken/kit#8354: the green phosphor body and the `TRACE` gauge; its opening and live
	// effects come with the epic's later children, so it types no opening line yet.
	matrix: {
		paint: run_board_header_trace.SHADES.body,
		intro: { line: '', letter_ms: 0, hold_ms: 0 },
		alert: run_board_header_trace.field_of,
		lamps: false,
		live: { types_rows: false, trill: false, codes: false, strip: false },
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
