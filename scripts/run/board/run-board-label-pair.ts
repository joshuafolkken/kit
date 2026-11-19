import { stripVTControlCharacters } from 'node:util'
import { run_board_fit } from './run-board-fit'

// joshuafolkken/kit#8154: an icon drawn beside the label that says what it marks — a column's
// `💪 CPU`, a section's `⏳ queued`, a row's `▶ backlogrun` — is put between two zero-width marks, the
// one place the board tells such an icon from the same icon before a value (`💪 67%`). The WarGames
// theme drops the marked icons, whose text would only repeat the label; every other frame drops the
// marks alone, so it is drawn as before.

const MARK = '\u{2060}'
const RULE = '─'
const BLANK = ' '
const PAIRED = new RegExp(`${MARK}([^${MARK}]*)${MARK}${BLANK}`, 'u')
// A rule's gap before a column's label; what opens a section heading before its label — the arrow
// of a screen that folds, the rule of one that does not.
const RULE_GAP = `${RULE}${BLANK}`
const HEADING_LEAD = /^(?:[▸▾]|──)\s$/u
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

// What a frame's form and theme are read from.
interface Drawn {
	form: 'screen' | 'chat'
	is_themed?: boolean | undefined
}

// A frame's lines with their marks kept only for the theme that drops their icons — a themed screen;
// a chat and a frame with no theme are drawn bare, as they were before the marks.
function settled(lines: ReadonlyArray<string>, drawn: Drawn): Array<string> {
	if (drawn.is_themed === true && drawn.form === 'screen') return [...lines]

	return lines.map((line) => bare(line))
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

const run_board_label_pair = { MARK, bare, dropped, pair, settled }

export { run_board_label_pair }
