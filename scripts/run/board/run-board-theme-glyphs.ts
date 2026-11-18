import { run_board_fit } from './run-board-fit'
import { run_board_labels } from './run-board-labels'

// joshuafolkken/kit#7988: the WarGames theme draws the board as a text terminal would, so every icon is
// drawn as ASCII text of the width the icon took — the columns line up as they do without the theme.
// The one table of what each icon reads as; the render modules keep their own icons and never see it.

type Glyphs = ReadonlyMap<string, string>

// Each emoji the board's sources draw, by what it marks; a text-presentation symbol one column wide
// gets one character. A section heading's icon reads as blanks, so only its word is left.
const EMOJI: Glyphs = new Map([
	['💻', '  '],
	['📈', '  '],
	['⛽', '  '],
	['🧵', '  '],
	['📌', '  '],
	['🚨', 'P1'],
	['🔺', 'P2'],
	['✨', 'FT'],
	['🐛', 'BG'],
	['🔍', 'IV'],
	['📝', 'PL'],
	['🔨', 'BD'],
	['👀', 'RV'],
	['🔀', 'MG'],
	['📦', 'CM'],
	['🔂', 'R2'],
	['🚢', 'SH'],
	['📣', 'RP'],
	['💥', 'FL'],
	['⏳', 'HD'],
	['💤', 'ZZ'],
	['✅', 'OK'],
	['🚫', 'XX'],
	['🔄', 'RN'],
	['🏁', 'FN'],
	['⏩', 'AD'],
	['🧊', 'PS'],
	['❔', '??'],
	['❓', 'Q?'],
	['❗', '!!'],
	['🔧', '> '],
	['💬', ': '],
	['🔭', 'WT'],
	['🔚', 'EN'],
	['⏰', 'T+'],
	['🎯', 'ET'],
	['💓', 'HB'],
	['🧠', 'MM'],
	['💾', 'DK'],
	['💪', 'CP'],
	['⚡', 'PW'],
	['🔥', 'HT'],
	['📴', 'OF'],
	['🔊', 'SN'],
	['🔇', 'MU'],
	['✋', 'HU'],
	['🙋', 'DC'],
	['🛑', 'ST'],
	['🧳', 'ER'],
	['🔗', 'LK'],
	['📂', 'FD'],
	['🧍', 'SO'],
	['🙅', 'NO'],
	['📋', 'OR'],
	['🚦', 'SG'],
	['🛫', 'TO'],
	['📮', 'IS'],
	['📅', 'NB'],
	['⚓', 'AN'],
	['🔁', 'RT'],
	['🆕', 'NW'],
	['🧨', 'XP'],
	['🚪', 'DR'],
	['📥', 'IN'],
	['📤', 'DS'],
	['🚀', 'GO'],
	['🤝', 'HO'],
	['🤔', 'JG'],
	['💭', 'SS'],
	['🚧', 'BL'],
	['🔒', 'LC'],
	['🪫', 'LO'],
	['📰', 'NS'],
	['🔏', 'HM'],
	['🔑', 'AU'],
	['🐰', 'CR'],
	['⛔', 'RL'],
	['🤏', 'CX'],
	['💺', 'SE'],
	['🏠', 'HQ'],
	['🌐', 'WB'],
	['👻', 'GH'],
	['🧭', 'SV'],
	['🎬', 'PA'],
	['🤖', 'AI'],
	['🙏', 'TY'],
	['🟢', 'AC'],
	['📁', 'EP'],
	['▶', '>'],
	['⏸', '='],
	['⏭', '>'],
	['⏱', 'T'],
	['↪', '^'],
	['🅿', 'P'],
	['☑', 'V'],
	['⛓', '#'],
	['🗓', 'D'],
	['⚠', '!'],
	['🛤', '='],
	['🗜', 'C'],
	['🖥', 'M'],
	['🎛', 'K'],
	['🏔', '^'],
])

// The one-column symbols drawn as one ASCII character. The rules and gauges (`■ █ ▁…▇ ┊ ├ └`) stay.
const SYMBOLS: Glyphs = new Map([
	['→', '>'],
	['↻', '@'],
	['▸', '>'],
	['▾', 'V'],
	['✚', '+'],
	['✓', '+'],
	['✗', 'X'],
])

// The spinner turns a line through `│ ╱ ─ ╲` instead of the braille dots, each frame the turn
// its place in the dots' cycle falls on, so one cycle of the dots is one turn.
const TURN = ['│', '╱', '─', '╲'] as const
const UNKNOWN = '?'
const VARIATION_SELECTOR = '\u{FE0F}'

function turn_of(index: number, count: number): string {
	return TURN[Math.floor((index * TURN.length) / count)] ?? TURN[0]
}

function spinner_turns(): Array<[string, string]> {
	const frames = run_board_labels.SPINNER_FRAMES

	return frames.map((frame, index) => [frame, turn_of(index, frames.length)])
}

const SINGLES: Glyphs = new Map([...SYMBOLS, ...spinner_turns()])
const SINGLE_CLASS = [...SINGLES.keys()].join('')
const PICTOGRAPHIC = String.raw`\p{Extended_Pictographic}`
const GLYPH = new RegExp(`${PICTOGRAPHIC}${VARIATION_SELECTOR}?|[${SINGLE_CLASS}]`, 'gu')

// An emoji, with its variation selector, as its text padded to the width it took; one the table
// misses as `?`, so no emoji is ever drawn.
function text_of(glyph: string): string {
	const single = SINGLES.get(glyph)

	if (single !== undefined) return single
	const text = EMOJI.get(glyph.replace(VARIATION_SELECTOR, '')) ?? UNKNOWN

	return text.padEnd(run_board_fit.width_of(glyph))
}

function textual(line: string): string {
	return line.replaceAll(GLYPH, (glyph: string) => text_of(glyph))
}

const run_board_theme_glyphs = { EMOJI, SYMBOLS, TURN, textual }

export { run_board_theme_glyphs }
