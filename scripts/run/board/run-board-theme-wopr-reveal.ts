import { run_board_theme_host_api } from './run-board-theme-host-api'
import type { Grid } from './run-board-theme-host-types'
import { run_board_theme_rules } from './run-board-theme-rules'

// The WARGAMES theme's opening reveal (joshuafolkken/kit#8917), ported from the confirmed theme demo
// (the removed run-board-intro.ts, run-board-reveal-blocks.ts): the first frame is written from the top, a line
// a beat, each line's beat shared evenly between its blocks — runs of words one blank apart, a rule
// `-` run on its own, a gauge's `■` ending its block, a title to the two blanks after it.

const { plain_of } = run_board_theme_host_api
const RULE_WORD = /^-+$/u
// Two blanks or more lead a new block.
const WIDE_GAP = 2
const PAIR = 2

// One word of a line and the blanks before it.
interface Pair {
	gap: string
	word: string
}

// What the words so far leave for the next: whether any showed, whether the last was a title or
// closed its block, and whether the rule row's title was seen.
interface Fold {
	is_shown: boolean
	is_title: boolean
	is_closed: boolean
	titled: boolean
}

const START: Fold = { is_shown: false, is_title: false, is_closed: false, titled: false }

function pairs_of(text: string): Array<Pair> {
	const parts = ['', ...text.trimEnd().split(/( +)/u)]
	const pairs: Array<Pair> = []

	for (let at = 0; at < parts.length; at += PAIR) {
		pairs.push({ gap: parts[at] ?? '', word: parts[at + 1] ?? '' })
	}

	return pairs.filter(({ gap, word }) => gap !== '' || word !== '')
}

// The rule row's first word that is no rule: its title.
function is_marked(fold: Fold, pair: Pair, is_rule_row: boolean): boolean {
	return is_rule_row && !fold.titled && pair.word !== '' && !RULE_WORD.test(pair.word)
}

function is_led(pair: Pair, is_mark: boolean): boolean {
	return pair.gap.length >= WIDE_GAP || is_mark
}

// Out of a title, a word after a closed block, or a rule run, starts its own.
function is_after_close(fold: Fold, pair: Pair): boolean {
	return !fold.is_title && (fold.is_closed || RULE_WORD.test(pair.word))
}

// Whether this word starts a new block.
function is_cut(fold: Fold, pair: Pair, is_mark: boolean): boolean {
	if (pair.word === '' || !fold.is_shown) return false

	return is_led(pair, is_mark) || is_after_close(fold, pair)
}

function is_title_word(fold: Fold, pair: Pair, is_mark: boolean): boolean {
	return is_mark || (fold.is_title && pair.gap.length < WIDE_GAP)
}

function is_closer(pair: Pair): boolean {
	return RULE_WORD.test(pair.word) || pair.word.includes('■')
}

function next_fold(fold: Fold, pair: Pair, is_mark: boolean): Fold {
	const is_title = is_title_word(fold, pair, is_mark)

	return {
		is_shown: fold.is_shown || pair.word !== '',
		titled: fold.titled || is_mark,
		is_title,
		is_closed: !is_title && is_closer(pair),
	}
}

// Where each block of a line's text ends.
function block_ends(text: string, is_rule_row: boolean): Array<number> {
	const ends: Array<number> = []
	let fold = START
	let col = 0

	for (const pair of pairs_of(text)) {
		const is_mark = is_marked(fold, pair, is_rule_row)

		col += pair.gap.length + pair.word.length
		if (is_cut(fold, pair, is_mark) || ends.length === 0) ends.push(col)
		else ends[ends.length - 1] = col
		fold = next_fold(fold, pair, is_mark)
	}

	return ends
}

// The columns of row `y` written `ms` into the reveal, a line every `line_ms`, of a `w`-wide screen.
function revealed_to(
	grid: Grid,
	y: number,
	ms: number,
	screen: { w: number; line_ms: number },
): number {
	const { w, line_ms } = screen
	const since = ms - y * line_ms

	if (since < 0) return 0
	const text = plain_of(grid, y)
	const ends = block_ends(text, run_board_theme_rules.is_rule_row(grid, y))

	if (ends.length === 0) return w
	// Block j is written j / n of the line's beat in, the first at once.
	const shown = Math.floor((since * ends.length) / line_ms) + 1

	return shown >= ends.length ? w : (ends[shown - 1] ?? w)
}

const run_board_theme_wopr_reveal = { block_ends, revealed_to }

export { run_board_theme_wopr_reveal }
