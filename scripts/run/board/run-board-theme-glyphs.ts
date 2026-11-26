import { run_board_escape } from './run-board-escape'
import { run_board_fit } from './run-board-fit'
import type { Icons } from './run-board-icons'
import { run_board_labels, type Paint } from './run-board-labels'
import { run_board_theme_defs, type Theme } from './run-board-theme-defs'
import { run_board_theme_glyph_table, type Glyph } from './run-board-theme-glyph-table'
import { run_board_theme_tones, type Tone } from './run-board-theme-tones'

// joshuafolkken/kit#7988: the WarGames theme draws the board as a text terminal would, so every icon is
// drawn as ASCII text of the width the icon took — the columns line up as they do without the theme.
// joshuafolkken/kit#8505: `shapes` draws a row's shape where it has one, else its letters; both stay as
// they are when the theme capitalizes the frame. The rows: `run-board-theme-glyph-table.ts`.

const { EMOJI, SYMBOLS } = run_board_theme_glyph_table

// The spinner steps through the base look's glyphs (`BASE_LOOK.spinner`, kana) instead of the braille
// dots on a themed board, each frame the glyph its place in the dots' cycle falls on, so one cycle of
// the dots is one pass through the glyphs; the theme host turns its own spinner over it.
const { BASE_LOOK } = run_board_theme_defs
// joshuafolkken/kit#8974: an emoji the table misses is drawn as blanks of its width, not `?`, so a
// name from a roster never reads as a question.
const UNKNOWN: Glyph = ['', 'info']
const VARIATION_SELECTOR = '\u{FE0F}'
const ESC = '\u{1B}'
// A color escape after its ESC; the codes that open a foreground color and that end one; the codes
// that turn bold or dim on and that end them.
const SGR_BODY = /^\[([\d;]*)m/u
const FOREGROUND = /^(?:3[0-8]|9[0-7])$/u
const DEFAULT_CODES: ReadonlySet<string> = new Set(['', '0', '39'])
const INTENSITY = /^[12]$/u
const INTENSITY_ENDS: ReadonlySet<string> = new Set(['', '0', '22'])

function turn_of(turn: string, index: number, count: number): string {
	return turn[Math.floor((index * turn.length) / count)] ?? ''
}

function spinner_turns(turn: string): Array<[string, Glyph]> {
	const frames = run_board_labels.SPINNER_FRAMES

	return frames.map((frame, index) => [frame, [turn_of(turn, index, frames.length), 'info']])
}

const TURNS = new Map(spinner_turns(BASE_LOOK.spinner))
const SPINNER: ReadonlySet<string> = new Set(run_board_labels.SPINNER_FRAMES)
const SINGLE_CLASS = [...SYMBOLS.keys(), ...run_board_labels.SPINNER_FRAMES].join('')
const PICTOGRAPHIC = String.raw`\p{Extended_Pictographic}`
// One emoji: a pictograph with its variation selector and skin tone, joined by ZWJ to more of them.
const PART = String.raw`${PICTOGRAPHIC}${VARIATION_SELECTOR}?[\u{1F3FB}-\u{1F3FF}]?`
const EMOJI_SEQUENCE = String.raw`${PART}(?:\u{200D}${PART})*`
const GLYPH = new RegExp(`${EMOJI_SEQUENCE}|[${SINGLE_CLASS}]`, 'gu')

// What a line's glyphs are drawn with: its theme, none for a board in no theme, and its icons.
interface GlyphLook {
	theme: Theme | undefined
	icons: Icons
}

const DEFAULT_LOOK: GlyphLook = { theme: 'wopr', icons: 'shapes' }

// A spinner dot takes the base look's glyph; a board in no theme keeps the dots.
function turn_entry(glyph: string, theme: Theme | undefined): Glyph | undefined {
	return theme === undefined ? undefined : TURNS.get(glyph)
}

function icon_entry(glyph: string): Glyph {
	return SYMBOLS.get(glyph) ?? EMOJI.get(glyph.replace(VARIATION_SELECTOR, '')) ?? UNKNOWN
}

// The row a glyph is drawn by; `undefined` where it is drawn as it is — every icon as `emoji`.
function entry_of(glyph: string, look: GlyphLook): Glyph | undefined {
	if (SPINNER.has(glyph)) return turn_entry(glyph, look.theme)

	return look.icons === 'emoji' ? undefined : icon_entry(glyph)
}

// A row's text: its shape as `shapes` where it has one, else its letters.
function drawn_text([letters, , shape = letters]: Glyph, icons: Icons): string {
	return icons === 'shapes' ? shape : letters
}

// The idle tone's paint: the base look's, else the tones' own dim.
function idle_of(theme: Theme | undefined): Paint | undefined {
	return theme === undefined ? undefined : BASE_LOOK.idle
}

// What a render module left open where a glyph is drawn: a foreground color, and the escapes of the
// bold or dim still on.
interface Open {
	is_colored: boolean
	intensity: string
}

const PLAIN: Open = { is_colored: false, intensity: '' }

// Inside a color a render module gave, the text is left uncolored, so that color is not cut; a tone
// that ends bold or dim (`ESC[22m`) is followed by the bold or dim the line had on.
function toned_text(text: string, tone: Tone, open: Open, idle: Paint | undefined): string {
	if (open.is_colored) return text
	const toned = run_board_theme_tones.toned(tone, text, idle)

	return toned === text ? text : toned + open.intensity
}

// An emoji, with its variation selector, as its text in its tone's color padded to the width it took;
// one the table misses as blanks of its width, so no emoji is drawn but as `emoji`.
function text_of(glyph: string, open: Open, look: GlyphLook): string {
	const entry = entry_of(glyph, look)

	if (entry === undefined) return glyph
	if (entry === UNKNOWN) return ' '.repeat(run_board_fit.width_of(glyph))
	const text = drawn_text(entry, look.icons)
	const padding = ' '.repeat(Math.max(0, run_board_fit.width_of(glyph) - text.length))

	return toned_text(text, entry[1], open, idle_of(look.theme)) + padding
}

function glyphs_as_text(text: string, open: Open, look: GlyphLook): string {
	return text.replaceAll(GLYPH, (glyph: string) => text_of(glyph, open, look))
}

// The first code of the color escape a segment starts with; `undefined` for any other segment.
function first_code(segment: string): string | undefined {
	return SGR_BODY.exec(segment)?.[1]?.split(';', 1)[0]
}

// What a code does to the foreground color: `true` opens one, `false` ends it, `undefined` leaves it.
function color_change(code: string): boolean | undefined {
	if (FOREGROUND.test(code)) return true

	return DEFAULT_CODES.has(code) ? false : undefined
}

// The bold and dim escapes on after a code.
function intensity_after(code: string, intensity: string): string {
	if (INTENSITY.test(code)) return `${intensity}${ESC}[${code}m`

	return INTENSITY_ENDS.has(code) ? '' : intensity
}

function opened(open: Open, segment: string): Open {
	const code = first_code(segment)

	if (code === undefined) return open

	return {
		is_colored: color_change(code) ?? open.is_colored,
		intensity: intensity_after(code, open.intensity),
	}
}

// Share the escape walk with renderers that must restore the line's existing bold and dim.
// joshuafolkken/kit#8591: a frame splits at its escapes (`run-board-escape.ts`), so `draw` is given its
// text only — a link's body or tmux's passthrough is kept as it came; a color escape updates `open`.
// joshuafolkken/kit#8649: a cursor move is an escape of its own too, so the spinner glyph after it is drawn.
function mapped(frame: string, draw: (text: string, open: Open) => string): string {
	let open = PLAIN

	return frame
		.split(run_board_escape.FRAME_ESCAPE)
		.map((part) => {
			if (!run_board_escape.is_escape(part)) return draw(part, open)
			open = opened(open, part.slice(ESC.length))

			return part
		})
		.join('')
}

// A board in no theme drawing `emoji` is the frame as its sources drew it.
function textual(frame: string, look: GlyphLook = DEFAULT_LOOK): string {
	if (look.theme === undefined && look.icons === 'emoji') return frame

	return mapped(frame, (text, open) => glyphs_as_text(text, open, look))
}

const run_board_theme_glyphs = { EMOJI, SYMBOLS, mapped, textual }

export { run_board_theme_glyphs }
