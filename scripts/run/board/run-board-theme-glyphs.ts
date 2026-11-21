import { run_board_fit } from './run-board-fit'
import { run_board_labels, type Paint } from './run-board-labels'
import { run_board_theme_defs, type Theme } from './run-board-theme-defs'
import { run_board_theme_tones, type Tone } from './run-board-theme-tones'

// joshuafolkken/kit#7988: the WarGames theme draws the board as a text terminal would, so every icon is
// drawn as ASCII text of the width the icon took — the columns line up as they do without the theme.
// The one table of what each icon reads as; the render modules keep their own icons and never see it.
// joshuafolkken/kit#8150: each text in the color of the tone of the state its icon marks.
// joshuafolkken/kit#8505: an icon read faster as a shape (`>>` running, `||` paused, `<-` waiting on an
// Issue) is drawn as one of the same width; a phase or priority keeps its code. A text stays as it is
// when the theme capitalizes the frame, and `⏸` takes the one-column rule `║`.

type Glyph = readonly [text: string, tone: Tone]
type Glyphs = ReadonlyMap<string, Glyph>

// Each emoji the board's sources draw, by what it marks; a text-presentation symbol one column wide
// gets one character. A section heading's icon reads as its rule, so every heading reads
// `V -- NAME` as one whose icon is dropped beside its label does (joshuafolkken/kit#8154).
const EMOJI: Glyphs = new Map<string, Glyph>([
	['💻', ['--', 'info']],
	['📈', ['--', 'info']],
	['⛽', ['--', 'info']],
	['🧵', ['--', 'info']],
	['📌', ['--', 'info']],
	['🚨', ['P1', 'alert']],
	['🔺', ['P2', 'caution']],
	['✨', ['**', 'info']],
	['🐛', ['BG', 'info']],
	['🔍', ['IV', 'running']],
	['📝', ['PL', 'running']],
	['🔨', ['BD', 'running']],
	['👀', ['RV', 'running']],
	['🔀', ['MG', 'done']],
	['📦', ['CM', 'running']],
	['🔂', ['R2', 'running']],
	['🚢', ['SH', 'done']],
	['📣', ['RP', 'running']],
	['💥', ['FL', 'alert']],
	['⏳', ['..', 'idle']],
	['💤', ['ZZ', 'idle']],
	['✅', ['OK', 'done']],
	['🚫', ['XX', 'alert']],
	['🔄', ['>>', 'running']],
	['🏁', ['|>', 'done']],
	['⏩', ['>|', 'idle']],
	['🧊', ['||', 'idle']],
	['❔', ['??', 'caution']],
	['❓', ['Q?', 'human']],
	['❗', ['!!', 'alert']],
	['🔧', ['> ', 'info']],
	['💬', [': ', 'info']],
	['🔭', ['OO', 'idle']],
	['🔚', ['-|', 'info']],
	['⏰', ['T+', 'caution']],
	['🕘', ['AG', 'idle']],
	['🎯', ['->', 'info']],
	['💓', ['<3', 'info']],
	['🧠', ['MM', 'info']],
	['💾', ['DK', 'info']],
	['💪', ['CP', 'info']],
	['⚡', ['PW', 'info']],
	['🔥', ['HT', 'alert']],
	['📴', ['OF', 'idle']],
	['🔊', ['<)', 'info']],
	['🔇', ['<X', 'idle']],
	['✋', ['HU', 'human']],
	['🙋', [String.raw`\O`, 'human']],
	['🛑', ['[]', 'alert']],
	['🧳', ['ER', 'info']],
	['🔗', ['<-', 'idle']],
	['📂', ['//', 'info']],
	['🧍', ['SO', 'info']],
	['🙅', ['NO', 'alert']],
	['📋', ['1.', 'info']],
	['🚦', ['SG', 'info']],
	['🛫', ['TO', 'info']],
	['📮', ['IS', 'info']],
	['📅', ['>=', 'idle']],
	['⚓', ['AN', 'info']],
	['🔁', ['<<', 'caution']],
	['🆕', ['NW', 'info']],
	['🧨', ['XP', 'alert']],
	['🚪', ['DR', 'info']],
	['📥', [String.raw`\/`, 'info']],
	['📤', ['/\\', 'info']],
	['🚀', ['^^', 'done']],
	['🤝', ['><', 'info']],
	['🤔', ['JG', 'caution']],
	['💭', ['SS', 'info']],
	['🚧', ['##', 'alert']],
	['🔒', ['LC', 'caution']],
	['🪫', ['[_', 'caution']],
	['📰', ['NS', 'info']],
	['🔏', ['HM', 'info']],
	['🔑', ['O-', 'info']],
	['🐰', ['CR', 'info']],
	['⛔', ['RL', 'alert']],
	['🤏', ['CX', 'info']],
	['💺', ['__', 'info']],
	['🏠', ['HQ', 'info']],
	['🌐', ['WB', 'info']],
	['👻', ['GH', 'info']],
	['🧭', ['SV', 'info']],
	['🎬', ['PA', 'info']],
	['🤖', ['AI', 'info']],
	['🙏', ['TY', 'info']],
	['🟢', ['AC', 'done']],
	['📁', ['[+', 'info']],
	['▶', ['>', 'info']],
	['⏸', ['║', 'idle']],
	['⏭', ['>', 'info']],
	['⏱', ['T', 'info']],
	['↪', ['^', 'info']],
	['🅿', ['P', 'info']],
	['☑', ['V', 'done']],
	['⛓', ['#', 'info']],
	['🗓', ['D', 'info']],
	['⚠', ['!', 'caution']],
	['🛤', ['=', 'info']],
	['🗜', ['C', 'info']],
	['🖥', ['M', 'info']],
	['🎛', ['K', 'info']],
	['🏔', ['^', 'info']],
])

// The one-column symbols drawn as one ASCII character. The rules and gauges (`■ █ ▁…▇ ┊ ├ └`) stay.
const SYMBOLS: Glyphs = new Map<string, Glyph>([
	['→', ['>', 'info']],
	['↻', ['@', 'info']],
	['▸', ['>', 'info']],
	['▾', ['V', 'info']],
	['✚', ['+', 'done']],
	['✓', ['+', 'done']],
	['✗', ['X', 'alert']],
])

// The spinner steps through its theme's glyphs (`spinner` in the theme table: wargames' `│ ╱ ─ ╲`,
// matrix's kana) instead of the braille dots, each frame the glyph its place in the dots' cycle
// falls on, so one cycle of the dots is one pass through the glyphs.
const { THEMES, THEME_DEFS } = run_board_theme_defs
const TURN = THEME_DEFS.wargames.spinner
const UNKNOWN: Glyph = ['?', 'info']
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

function spinner_turns(theme: Theme): Array<[string, Glyph]> {
	const frames = run_board_labels.SPINNER_FRAMES
	const turn = THEME_DEFS[theme].spinner

	return frames.map((frame, index) => [frame, [turn_of(turn, index, frames.length), 'info']])
}

const SINGLES = new Map(
	THEMES.map((theme) => [theme, new Map([...SYMBOLS, ...spinner_turns(theme)])]),
)
const SINGLE_CLASS = [...SYMBOLS.keys(), ...run_board_labels.SPINNER_FRAMES].join('')
const PICTOGRAPHIC = String.raw`\p{Extended_Pictographic}`
const GLYPH = new RegExp(`${PICTOGRAPHIC}${VARIATION_SELECTOR}?|[${SINGLE_CLASS}]`, 'gu')

function entry_of(glyph: string, theme: Theme): Glyph {
	return (
		SINGLES.get(theme)?.get(glyph) ?? EMOJI.get(glyph.replace(VARIATION_SELECTOR, '')) ?? UNKNOWN
	)
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
function toned_text(text: string, tone: Tone, open: Open, idle: Paint): string {
	if (open.is_colored) return text
	const toned = run_board_theme_tones.toned(tone, text, idle)

	return toned === text ? text : toned + open.intensity
}

// An emoji, with its variation selector, as its text in its tone's color padded to the width it took;
// one the table misses as `?`, so no emoji is ever drawn.
function text_of(glyph: string, open: Open, theme: Theme): string {
	const [text, tone] = entry_of(glyph, theme)
	const padding = ' '.repeat(Math.max(0, run_board_fit.width_of(glyph) - text.length))

	return toned_text(text, tone, open, THEME_DEFS[theme].idle) + padding
}

function glyphs_as_text(text: string, open: Open, theme: Theme): string {
	return text.replaceAll(GLYPH, (glyph: string) => text_of(glyph, open, theme))
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
function mapped(frame: string, draw: (text: string, open: Open) => string): string {
	const [head = '', ...escaped] = frame.split(ESC)
	const drawn = [draw(head, PLAIN)]
	let open = PLAIN

	for (const segment of escaped) {
		open = opened(open, segment)
		drawn.push(draw(segment, open))
	}

	return drawn.join(ESC)
}

function textual(frame: string, theme: Theme = 'wargames'): string {
	return mapped(frame, (text, open) => glyphs_as_text(text, open, theme))
}

const run_board_theme_glyphs = { EMOJI, SYMBOLS, TURN, mapped, textual }

export { run_board_theme_glyphs }
