import { run_board_header_trace } from './run-board-header-trace'
import type { Paint } from './run-board-labels'
import { run_board_sound_click } from './run-board-sound-click'
import { run_board_sound_codec } from './run-board-sound-codec'
import { run_board_sound_enter } from './run-board-sound-enter'
import { run_board_sound_keypad } from './run-board-sound-keypad'
import { run_board_sound_nixie } from './run-board-sound-nixie'
import { run_board_sound_palettes_extra } from './run-board-sound-palettes-extra'
import { run_board_sound_palettes_film } from './run-board-sound-palettes-film'
import { run_board_sound_palettes_more } from './run-board-sound-palettes-more'
import { run_board_sound_palettes_rk800 } from './run-board-sound-palettes-rk800'
import { run_board_sound_score, type Palette, type Score } from './run-board-sound-score'
import { run_board_sound_skynet } from './run-board-sound-skynet'
import { run_board_sound_typing } from './run-board-sound-typing'
import { run_board_theme_ghost_data } from './run-board-theme-ghost-data'
import { run_board_theme_isac_data } from './run-board-theme-isac-data'
import { run_board_theme_magi_data } from './run-board-theme-magi-data'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_tones } from './run-board-theme-tones'

// joshuafolkken/kit#8349: what each theme carries, one row per theme — a theme is added by adding its
// row, and the theme values the CLI and the worker accept are this table's keys. joshuafolkken/kit#8917:
// a theme is drawn by the theme host alone (`run-board-theme-registry.ts`), each value the board's name
// after `josh-`; what a row still holds is the board's name and the voice its typing sounds in. A board
// in a theme draws its base in one palette, `BASE_LOOK`, which the host reads back as roles
// (`run-board-theme-roles.ts`) and paints in the theme's own colors.

// joshuafolkken/kit#8441: lines typed before the theme's line, each held for `hold_ms`, then followed by
// `gap_ms` — the opening's sound counts their letters (`run-board-theme-sound.ts`).
interface IntroLeads {
	lines: ReadonlyArray<string>
	hold_ms: number
	gap_ms: number
}

// The opening's line and the pause after each letter its sound is timed by.
interface IntroDefinition {
	line: string
	letter_ms: number
	leads?: IntroLeads
}

interface ThemeDefinition {
	// The board's name the header and the no-run line draw in place of `josh-board`.
	name: string
	// The opening's sound: its line's letters, at `letter_ms` each (joshuafolkken/kit#8365).
	intro: IntroDefinition
	// The WAV a live board loops while letters type at `letter_ms`, `undefined` when it cannot be
	// written (joshuafolkken/kit#8365).
	typing: (letter_ms: number) => string | undefined
	// joshuafolkken/kit#8697: the WAV a live board plays once a line types through, `undefined` when it
	// has none or cannot be written.
	typed_end: () => string | undefined
	// joshuafolkken/kit#8917: the WAVs a themed board plays once as a NOTICE, a ROW, a PROGRESS or a part
	// starts, each laid out on that event's own time line (`run-board-sound-score.ts`).
	score: Score
}

// The look a themed board's base is drawn in: the green phosphor palette the confirmed demo's frame was
// captured in, so each color names one role — the text, the rules' dashes and headings, the idle and the
// info marks, the alert field the throughput rule ends on (`run-board-header-defcon.ts` → `level_of`, 1 the worst)
// and the spinner's glyphs.
interface BaseLook {
	paint: Paint
	rule: { dash: Paint; text: Paint }
	idle: Paint
	info: Paint
	alert: (level: number) => string | undefined
	spinner: string
}

const { SHADES } = run_board_header_trace
const { MARK_PAINTS } = run_board_theme_tones

// The idle and the info marks each take a paint no other text of the base has
// (`run-board-theme-tones.ts` → `MARK_PAINTS`), so the host reads them back as roles of their own.
const BASE_LOOK: BaseLook = {
	paint: SHADES.body,
	rule: { dash: SHADES.dark, text: SHADES.mid },
	idle: MARK_PAINTS.idle,
	info: MARK_PAINTS.info,
	alert: run_board_header_trace.field_of,
	spinner: 'ｦｱｳｴｵｶｷｹｺｻ',
}

function no_sound(): undefined {
	// A theme with no typed-end sound writes no WAV.
}

const { CODEC, MAGI, NIXIE, SKYNET } = run_board_sound_palettes_more
const { FLUX, TRACE, WOPR } = run_board_sound_palettes_film
const { RK800, RK800_VOICES } = run_board_sound_palettes_rk800
const { GHOST, GHOST_VOICES, ISAC, ISAC_VOICES } = run_board_sound_palettes_extra
const { OPEN: RK800_OPEN } = run_board_theme_rk800_data
const { OPEN: ISAC_OPEN } = run_board_theme_isac_data
const { ASSEMBLE: GHOST_ASSEMBLE } = run_board_theme_ghost_data
const { score_of } = run_board_sound_score

// The teletype the wargames board types in.
const TELETYPE: Omit<ThemeDefinition, 'name'> = {
	intro: { line: 'SHALL WE PLAY A GAME?', letter_ms: 50 },
	typing: run_board_sound_typing.teletype_wav,
	typed_end: run_board_sound_palettes_film.wopr_typed_wav,
	score: score_of(WOPR),
}

// A work's own voices (joshuafolkken/kit#8917): its typing, its typed end and its score, the teletype's
// opening line kept.
function voiced(
	sound: { typing_wav: ThemeDefinition['typing']; typed_wav: ThemeDefinition['typed_end'] },
	palette: Palette,
): Omit<ThemeDefinition, 'name'> {
	return {
		intro: TELETYPE.intro,
		typing: sound.typing_wav,
		typed_end: sound.typed_wav,
		score: score_of(palette),
	}
}

const THEME_DEFS = {
	// The film's war-planning computer, WOPR.
	wopr: { name: 'josh-wopr', ...TELETYPE },
	// The film's opening terminal line, `Trace program: running`; a key click every two letters.
	trace: {
		name: 'josh-trace',
		intro: {
			line: 'Knock, knock, Josh.',
			letter_ms: 50,
			leads: {
				lines: ['Wake up, Josh...', 'The board has you...', 'Follow the white rabbit.'],
				hold_ms: 1100,
				gap_ms: 300,
			},
		},
		typing: run_board_sound_click.typing_wav,
		typed_end: no_sound,
		score: score_of(TRACE),
	},
	// The time machine's board: the time-circuit keypad while a line types, its ENTER once typed through.
	flux: {
		name: 'josh-flux',
		intro: { line: run_board_sound_keypad.LINE, letter_ms: 50 },
		typing: run_board_sound_keypad.typing_wav,
		typed_end: run_board_sound_enter.enter_wav,
		score: score_of(FLUX),
	},
	codec: { name: 'josh-codec', ...voiced(run_board_sound_codec, CODEC) },
	nixie: { name: 'josh-nixie', ...voiced(run_board_sound_nixie, NIXIE) },
	skynet: { name: 'josh-skynet', ...voiced(run_board_sound_skynet, SKYNET) },
	// joshuafolkken/kit#8917: magi's opening types its own title, so its sound counts that title's letters.
	magi: {
		name: 'josh-magi',
		...voiced(
			{
				typing_wav: run_board_sound_palettes_more.magi_typing_wav,
				typed_wav: run_board_sound_palettes_more.magi_typed_wav,
			},
			MAGI,
		),
		intro: { line: run_board_theme_magi_data.MAGI_OPEN.title, letter_ms: TELETYPE.intro.letter_ms },
	},
	// Each of the three below types its own opening from the first tick, so its sound counts those letters:
	// rk800's date card, two letters a tick.
	rk800: {
		name: 'josh-rk800',
		...voiced(RK800_VOICES, RK800),
		intro: { line: RK800_OPEN.line, letter_ms: RK800_OPEN.letter_ms },
	},
	// isac's title.
	isac: {
		name: 'josh-isac',
		...voiced(ISAC_VOICES, ISAC),
		intro: { line: ISAC_OPEN.title, letter_ms: ISAC_OPEN.letter_ms },
	},
	// ghost's wave of digits, a letter a tick for as long as the wave runs.
	ghost: {
		name: 'josh-ghost',
		...voiced(GHOST_VOICES, GHOST),
		intro: { line: GHOST_ASSEMBLE.line, letter_ms: GHOST_ASSEMBLE.letter_ms },
	},
} as const satisfies Readonly<Record<string, ThemeDefinition>>

type Theme = keyof typeof THEME_DEFS

// Issue 4-2: the works' full titles and short names a theme is also launched by, each read as the value
// it names; the board holds only the values.
const THEME_ALIASES: ReadonlyMap<string, Theme> = new Map<string, Theme>([
	['wargames', 'wopr'],
	['matrix', 'trace'],
	['bttf', 'flux'],
	['backtothefuture', 'flux'],
	['metalgear', 'codec'],
	['mgs', 'codec'],
	['steinsgate', 'nixie'],
	['sg', 'nixie'],
	['terminator', 'skynet'],
	['evangelion', 'magi'],
	['eva', 'magi'],
	['detroit', 'rk800'],
	['dbh', 'rk800'],
	['division', 'isac'],
	['shd', 'isac'],
	['gits', 'ghost'],
	['shell', 'ghost'],
])

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

const run_board_theme_defs = {
	BASE_LOOK,
	THEMES,
	THEME_ALIASES,
	THEME_DEFS,
	names_of,
}

export { run_board_theme_defs }
export type { BaseLook, IntroDefinition, IntroLeads, Theme, ThemeDefinition }
