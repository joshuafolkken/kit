import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_parts } from './run-board-theme-deviant-parts'
import { run_board_theme_draw, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Cell, Grid } from './run-board-theme-host-types'

// The deviant theme's PROGRESS on the rules: every section's rule becomes the analysis bar — bright
// red grows from the left over a dark red track as the line types; the tick it has typed they all
// turn blue and a light runs out to the rule's end; then they ease back to the rule's own color. A
// recolor of the rules' own cells only; the headings on them are left alone.

const { is_rule, restyle } = run_board_theme_host_grid
const { BLANK, typed_share } = run_board_theme_draw
const { RGB, RULES, RULE_ROW } = run_board_theme_deviant_data
const { bold, ink, mix } = run_board_theme_deviant_parts

// A column's style on the bar.
type BarInk = (x: number) => string

// Whether row `y` is a section's rule: a rule's cell among its first few.
function is_rule_row(grid: Grid, y: number): boolean {
	return (grid[y] ?? []).slice(0, RULES.lead).some((cell) => is_rule(cell))
}

// The rows the bar runs on: every section's rule on the board.
function rule_rows(draw: ThemeDraw): Array<number> {
	return [...draw.grid.keys()].filter((y) => is_rule_row(draw.grid, y))
}

// Once the line has typed: blue with a light running out to the edge, then easing to the rule's color.
function done_ink(cooled: number, edge: number): BarInk | undefined {
	const head = (cooled / RULES.run) * edge
	const [light, blue] = [bold(mix(RGB.blue, RGB.white, RULES.glow)), bold(RGB.blue)]
	const eased = ink(mix(RGB.blue, RGB.steel, (cooled - RULES.run) / RULES.ease))

	if (cooled >= RULES.run + RULES.ease) return undefined
	if (cooled >= RULES.run) return () => eased

	return (x) => (x <= head && x > head - RULES.glint ? light : blue)
}

function bar_ink(draw: ThemeDraw): BarInk | undefined {
	const { progress } = draw.s
	const { edge } = draw.api.layout
	const lit = typed_share(progress) * edge
	const [bright, track] = [bold(RGB.red), ink(RGB.track)]

	if (!progress.is_typing) return done_ink(progress.cooled, edge)

	return (x) => (x < lit ? bright : track)
}

// The rule row's mark: a character on one of its first cells.
function is_mark([ch]: Cell, x: number): boolean {
	return x < RULE_ROW.mark && ch.trim() !== ''
}

// The bar runs over the rules' own cells and their rows' marks.
function rule_bar(draw: ThemeDraw): void {
	const style = bar_ink(draw)

	if (style === undefined) return
	const rows = new Set(rule_rows(draw))

	restyle(
		draw.grid,
		(cell, x, y) => rows.has(y) && (is_rule(cell) || is_mark(cell, x)),
		(x) => style(x),
	)
}

// A run of a rule row's cells in the plain `body` role with a character on each: a heading's word, a
// count, a column's label.
interface Word {
	x: number
	end: number
	text: string
}

// The inks of a rule row's parts on the normal display: the mark, a count, a column's label, the
// heading's first word and its other words.
const INKS = {
	mark: ink(RGB.blue),
	count: ink(RGB.cyan),
	label: ink(mix(RGB.soft, RGB.night, RULE_ROW.label_dim)),
	head: bold(RGB.white),
	rest: ink(RGB.soft),
}
// A count: digits, with no letter beside them.
const COUNT = /^(?=.*\d)\P{L}*$/u

function grow(words: Array<Word>, x: number, ch: string): void {
	const last = words.at(-1)

	if (last?.end === x) words[words.length - 1] = { ...last, end: x + 1, text: `${last.text}${ch}` }
	else words.push({ x, end: x + 1, text: ch })
}

function body_words(row: ReadonlyArray<Cell>): Array<Word> {
	const words: Array<Word> = []

	for (const [x, [ch, style]] of row.entries()) {
		if (style === 'body' && ch.trim() !== '') grow(words, x, ch)
	}

	return words
}

// The column the rule's line first runs from — its first few cells in a row — past which a word is a
// column's label; past the row's end where it never runs.
function line_from(row: ReadonlyArray<Cell>): number {
	const run = Array.from({ length: RULE_ROW.run }, (_, offset) => offset)
	const at = row.findIndex((_, x) => run.every((offset) => is_rule(row[x + offset] ?? BLANK)))

	return at === -1 ? row.length : at
}

function word_ink(word: Word, index: number, line: number): string {
	if (COUNT.test(word.text)) return INKS.count
	if (word.x >= line) return INKS.label

	return index === 0 ? INKS.head : INKS.rest
}

function ink_word(row: Array<Cell>, word: Word, style: string): void {
	const cells = row.slice(word.x, word.end).map(([ch]): Cell => [ch, style])

	row.splice(word.x, cells.length, ...cells)
}

function ink_mark(row: Array<Cell>): void {
	for (const [x, cell] of row.slice(0, RULE_ROW.mark).entries()) {
		if (is_mark(cell, x)) row[x] = [cell[0], INKS.mark]
	}
}

function ink_row(row: Array<Cell>): void {
	const line = line_from(row)

	for (const [index, word] of body_words(row).entries()) {
		ink_word(row, word, word_ink(word, index, line))
	}

	ink_mark(row)
}

// The normal display's rule rows, their parts told apart by place and text — every one of them shares
// the `body` role but the line and the mark: the mark bright blue, a count cyan, the heading's first
// word white bold and its others soft, a column's label — a word past the line's first run — a dimmer
// soft. The line's own cells and a cell already in a color of its own (`OK`, `P1`, `T+`) are left;
// laid before every effect, which repaints over it.
function rule_inks(draw: ThemeDraw): void {
	const rows = rule_rows(draw).map((y) => draw.grid[y])

	for (const row of rows) if (row) ink_row(row)
}

const run_board_theme_deviant_rules = { is_rule_row, rule_bar, rule_inks, rule_rows }

export { run_board_theme_deviant_rules }
