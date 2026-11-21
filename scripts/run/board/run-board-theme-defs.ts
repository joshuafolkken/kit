import { run_board_header_defcon } from './run-board-header-defcon'
import { run_board_header_trace } from './run-board-header-trace'
import type { Paint } from './run-board-labels'
import { run_board_theme_tones } from './run-board-theme-tones'

// joshuafolkken/kit#8349: what each theme draws, one row per theme — a theme is added by adding its
// row, and the theme names the CLI and the worker accept are this table's keys.

// joshuafolkken/kit#8441: lines typed before the theme's line in `paint`, each held with its cursor for
// `hold_ms`, then erased and followed by `gap_ms`; where a theme has them, its line shows at once.
interface IntroLeads {
	lines: ReadonlyArray<string>
	hold_ms: number
	gap_ms: number
	paint: Paint
}

interface IntroDefinition {
	// The line typed before the first frame — shown at once after the theme's leads where it has them —
	// and the pauses after each letter and after the line.
	line: string
	letter_ms: number
	hold_ms: number
	leads?: IntroLeads
}

// The live board's effects (joshuafolkken/kit#8360): whether each row types as it appears, and whether
// the trill sounds while it types, and whether the section rules run launch codes while it types where
// the lamp panel shows (`run-board-codes.ts`; joshuafolkken/kit#8375), and whether a lamp strip fills
// above each rule by typing progress where the rules run code (`run-board-strip.ts`; joshuafolkken/kit#8376)
// — off in every theme for now, kept to switch back on (joshuafolkken/kit#8398) — and whether each row
// decodes from code rather than types (`run-board-decode.ts`) and the lamp panel's cells run the idle rain
// rather than blink (`run-board-idle-rain.ts`; joshuafolkken/kit#8356).
interface LiveDefinition {
	sweep: boolean
	types_rows: boolean
	trill: boolean
	codes: boolean
	strip: boolean
	decode: boolean
	rain: boolean
}

interface ThemeDefinition {
	// The color the theme draws text no color is given in.
	paint: Paint
	// Section dashes and heading text, and the theme's idle glyphs (joshuafolkken/kit#8390).
	rule: { dash: Paint; text: Paint }
	idle: Paint
	intro: IntroDefinition
	// The alert field a screen's throughput rule ends on, drawn from the level every theme shares
	// (`run-board-header-defcon.ts` → `level_of`), 1 the worst (joshuafolkken/kit#8358).
	alert: (level: number) => string
	// Whether a live board in the theme draws the lamp panel (`run-board-lamps.ts`;
	// joshuafolkken/kit#8359).
	lamps: boolean
	// Glyphs spread over the board spinner's cycle, in order (joshuafolkken/kit#8366).
	spinner: string
	live: LiveDefinition
}

const CYAN: Paint = { rgb: '62;236;225', named: 'cyan' }
const { IDLE_PAINT } = run_board_theme_tones

const THEME_DEFS = {
	wargames: {
		// The cyan of the film terminal's phosphor glyph core in 24-bit color, else the palette's own cyan.
		paint: CYAN,
		// The rules in the idle tone, behind the row typing (joshuafolkken/kit#8397).
		rule: { dash: IDLE_PAINT, text: CYAN },
		idle: IDLE_PAINT,
		intro: { line: 'SHALL WE PLAY A GAME?', letter_ms: 50, hold_ms: 2000 },
		alert: run_board_header_defcon.field_of,
		lamps: true,
		spinner: '│╱─╲',
		live: {
			sweep: true,
			types_rows: true,
			trill: true,
			codes: true,
			strip: false,
			decode: false,
			rain: false,
		},
	},
	// joshuafolkken/kit#8354: the green phosphor body and the `TRACE` gauge; its opening types three
	// lines and shows the last at once (joshuafolkken/kit#8441); its new rows decode and the idle rain
	// runs where the lamps sit (joshuafolkken/kit#8356).
	matrix: {
		paint: run_board_header_trace.SHADES.body,
		rule: { dash: run_board_header_trace.SHADES.dark, text: run_board_header_trace.SHADES.mid },
		idle: run_board_header_trace.SHADES.mid,
		intro: {
			line: 'KNOCK, KNOCK, JOSH.',
			letter_ms: 50,
			hold_ms: 1300,
			leads: {
				lines: ['WAKE UP, JOSH...', 'THE BOARD HAS YOU...', 'FOLLOW THE WHITE RABBIT.'],
				hold_ms: 1100,
				gap_ms: 300,
				paint: run_board_header_trace.SHADES.bright,
			},
		},
		alert: run_board_header_trace.field_of,
		lamps: true,
		spinner: 'ｦｱｳｴｵｶｷｹｺｻ',
		live: {
			sweep: false,
			types_rows: true,
			trill: false,
			codes: false,
			strip: false,
			decode: true,
			rain: true,
		},
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

// The theme rows whose live effects a reader reads.
type LiveDefs = Readonly<Partial<Record<string, Pick<ThemeDefinition, 'live'>>>>

const NO_LIVE: LiveDefinition = {
	sweep: false,
	types_rows: false,
	trill: false,
	codes: false,
	strip: false,
	decode: false,
	rain: false,
}

// The live effects a theme's definition chooses (joshuafolkken/kit#8360); a board in no theme has none.
function live_of(theme: Theme | undefined, defs: LiveDefs = THEME_DEFS): LiveDefinition {
	if (theme === undefined) return NO_LIVE

	return defs[theme]?.live ?? NO_LIVE
}

const run_board_theme_defs = {
	THEMES,
	THEME_DEFS,
	live_of,
	names_of,
}

export { run_board_theme_defs }
export type { IntroDefinition, IntroLeads, LiveDefinition, LiveDefs, Theme, ThemeDefinition }
