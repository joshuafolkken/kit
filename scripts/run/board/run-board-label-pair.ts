import { stripVTControlCharacters } from 'node:util'
import { run_board_fit } from './run-board-fit'
import type { Theme } from './run-board-theme-defs'

// joshuafolkken/kit#8154: an icon drawn beside the label that says what it marks — a column's
// `💪 CPU`, a section's `⏳ queued`, a row's `▶ backlogrun` — is put between two zero-width marks, the
// one place the board tells such an icon from the same icon before a value (`💪 67%`). The WarGames
// theme drops the marked icons, whose text would only repeat the label; every other frame drops the
// marks alone, so it is drawn as before.

const MARK = '\u{2060}'
// joshuafolkken/kit#8224: a zero-width mark before a row's title, the one place the WarGames reveal
// tells a title from the words before it (`run-board-reveal-blocks.ts`); a frame kept for the theme
// carries it to the theme, which drops it as it draws, and every other frame drops it here.
const TITLE_MARK = '\u{2063}'
const RULE = '─'
const BLANK = ' '
const PAIRED = new RegExp(`${MARK}([^${MARK}]*)${MARK}${BLANK}`, 'u')
// A rule's gap before a column's label; what opens a section heading before its label — the arrow
// of a screen that folds, the rule of one that does not, and the one rule character a screen that
// folds leads a section no key folds with (joshuafolkken/kit#8257).
const RULE_GAP = `${RULE}${BLANK}`
const HEADING_LEAD = /^(?:[▸▾]|──?)\s$/u
// The blanks a row's label is padded with before its cells.
const LABEL_END = `${BLANK}${BLANK}`

// `icon word`, the icon marked as the label's.
function pair(icon: string, word: string): string {
	return `${MARK}${icon}${MARK}${BLANK}${word}`
}

// The text without its marks, as a frame no theme restyles is drawn.
function bare(text: string): string {
	return text.replaceAll(MARK, '')
}

// The text without its title marks, as every write a person or a chat reads draws it.
function untitled(text: string): string {
	return text.replaceAll(TITLE_MARK, '')
}

// A title marked at its start.
function titled(title: string): string {
	return `${TITLE_MARK}${title}`
}

// What a frame's form and theme are read from.
interface Drawn {
	form: 'screen' | 'chat'
	theme?: Theme | undefined
}

// A frame's lines with their marks kept only for the theme that drops their icons — a themed screen;
// a chat and a frame with no theme are drawn bare, as they were before the marks.
function settled(lines: ReadonlyArray<string>, drawn: Drawn): Array<string> {
	if (drawn.theme !== undefined && drawn.form === 'screen') return [...lines]

	return lines.map((line) => bare(untitled(line)))
}

function rule_of(icon: string): string {
	return RULE.repeat(run_board_fit.width_of(icon))
}

// A section heading's icon reads as its rule, the gap before it kept: `V -- NAME`, `-- -- NAME`.
function headed(before: string, icon: string, after: string): string {
	return `${before}${rule_of(icon)}${BLANK}${after}`
}

// In a column's rule the icon's columns, and the gap before it, are drawn as the rule.
function ruled(before: string, icon: string, after: string): string {
	return `${before.slice(0, -BLANK.length)}${RULE}${rule_of(icon)}${BLANK}${after}`
}

// On a row the label moves into the icon's columns, which are kept after it, so the cells stay put.
function shifted(before: string, icon: string, after: string): string {
	const freed = BLANK.repeat(run_board_fit.width_of(icon) + BLANK.length)
	const end = after.indexOf(LABEL_END)
	const at = end === -1 ? after.length : end

	return `${before}${after.slice(0, at)}${freed}${after.slice(at)}`
}

function unpaired(line: string, match: RegExpExecArray): string {
	const before = line.slice(0, match.index)
	const after = line.slice(match.index + match[0].length)
	const icon = match[1] ?? ''
	const lead = stripVTControlCharacters(before)

	if (HEADING_LEAD.test(lead)) return headed(before, icon, after)

	return lead.endsWith(RULE_GAP) ? ruled(before, icon, after) : shifted(before, icon, after)
}

function dropped_line(line: string): string {
	let drawn = line

	for (let match = PAIRED.exec(drawn); match !== null; match = PAIRED.exec(drawn)) {
		drawn = unpaired(drawn, match)
	}

	return drawn
}

// The frame with each marked icon dropped: in a heading or a column's rule its columns drawn as the
// rule, on a row its label moved into them.
function dropped(frame: string): string {
	return frame
		.split('\n')
		.map((line) => dropped_line(line))
		.join('\n')
}

const run_board_label_pair = { MARK, TITLE_MARK, bare, dropped, pair, settled, titled, untitled }

export { run_board_label_pair }
