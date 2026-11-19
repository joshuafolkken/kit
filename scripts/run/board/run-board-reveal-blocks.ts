import { stripVTControlCharacters } from 'node:util'
import { run_board_label_pair } from './run-board-label-pair'

// joshuafolkken/kit#8224: the WarGames reveal writes a line of its first frame a block at a time, left
// to right, the line's beat shared out evenly between its blocks. A block is a run of words one blank
// apart (`PW /H`, `AC ACTIVE`); two blanks or more start the next one, the blanks written with it. A run
// of `-` with a blank or the line's end either side is a rule, a block of its own; a word holding a
// gauge's `■` ends its block; a title, marked at its start, is a block of its own up to the two blanks
// after it. The line is read as the theme drew it: an escape holds no blank, so a split at a blank
// never cuts one, and it weighs nothing in what is shown.

const { TITLE_MARK, untitled } = run_board_label_pair
const LINE_MS = 75
const GAUGE = '■'
const RULE = /^-+$/u
const BLANKS = /( +)/u
const GAP_BLANKS = 2
// A word and the blanks before it are two parts of the line split at its blanks.
const PART_PAIR = 2

interface Beat {
	text: string
	ms: number
}

interface Word {
	gap: string
	text: string
}

interface Fold {
	blocks: Array<string>
	// Whether the last block shows anything — a block of escapes alone takes the next word in.
	is_shown: boolean
	// Whether the last word was a title's, which no rule or gauge cuts.
	is_title: boolean
	// Whether the last word was a rule or a gauge, which the next word starts a block after.
	is_closed: boolean
}

const START: Fold = { blocks: [], is_shown: false, is_title: false, is_closed: false }

// Each word with the blanks before it; blanks the line ends on are a word with no text.
function words_of(line: string): Array<Word> {
	const parts = ['', ...line.split(BLANKS)]
	const words: Array<Word> = []

	for (let at = 0; at < parts.length; at += PART_PAIR) {
		words.push({ gap: parts[at] ?? '', text: parts[at + 1] ?? '' })
	}

	return words.filter((word) => word.gap !== '' || word.text !== '')
}

function is_led(word: Word): boolean {
	return word.gap.length >= GAP_BLANKS || word.text.includes(TITLE_MARK)
}

// A word that shows starts a block after one that shows, where it is led apart from it, is a rule, or
// follows a rule or a gauge — but never within a title.
function is_ruled(fold: Fold, shown: string): boolean {
	return !fold.is_title && (fold.is_closed || RULE.test(shown))
}

function is_cut(fold: Fold, word: Word, shown: string): boolean {
	if (shown === '' || !fold.is_shown) return false

	return is_led(word) || is_ruled(fold, shown)
}

function joined(blocks: ReadonlyArray<string>, piece: string): Array<string> {
	const last = blocks.at(-1)

	return last === undefined ? [piece] : [...blocks.slice(0, -1), `${last}${piece}`]
}

function is_title(fold: Fold, word: Word): boolean {
	return word.text.includes(TITLE_MARK) || (fold.is_title && word.gap.length < GAP_BLANKS)
}

function folded(fold: Fold, word: Word): Fold {
	const text = untitled(word.text)
	const shown = stripVTControlCharacters(text)
	const piece = `${word.gap}${text}`
	const is_titled = is_title(fold, word)

	return {
		blocks: is_cut(fold, word, shown) ? [...fold.blocks, piece] : joined(fold.blocks, piece),
		is_shown: fold.is_shown || shown !== '',
		is_title: is_titled,
		is_closed: !is_titled && (RULE.test(shown) || shown.includes(GAUGE)),
	}
}

// The line's blocks in order, its title marks dropped; they join back into the line without them.
function blocks_of(line: string): Array<string> {
	let fold = START

	for (const word of words_of(line)) fold = folded(fold, word)

	return fold.blocks
}

// The line's blocks, each a beat of an even share of the line's; a line with none is one beat.
function beats_of(line: string): Array<Beat> {
	const blocks = blocks_of(line)

	if (blocks.length === 0) return [{ text: '', ms: LINE_MS }]

	return blocks.map((text) => ({ text, ms: LINE_MS / blocks.length }))
}

const run_board_reveal_blocks = { LINE_MS, beats_of, blocks_of }

export { run_board_reveal_blocks }
export type { Beat }
