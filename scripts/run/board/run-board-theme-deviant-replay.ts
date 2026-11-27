import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_parts } from './run-board-theme-deviant-parts'
import { run_board_theme_deviant_scrub, type Scrub } from './run-board-theme-deviant-scrub'
import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { ThemeLayout } from './run-board-theme-host-types'

// The deviant theme's clue cards inside a ROW's area. As the timeline's head passes their ticks, up
// to three cards appear over the timeline, each tied to its tick by a right-angle line and filled
// from what the board tells of the new lane, and EVENTS ANALYZED counts them. As the lane settles
// the rest of the area dims under the stamp and the cards.

const { restyle } = run_board_theme_host_grid
const { PAIR, put_in } = run_board_theme_draw
const { PANEL, RGB, TIMELINE } = run_board_theme_deviant_data
const { bold, ink, mix } = run_board_theme_deviant_parts
const { tick_every } = run_board_theme_deviant_scrub

// The clue cards: the rows a pane must have for them, where along the track their ticks stand, the
// labels under a lane's number and state, and how far the rest of the area dims as the lane settles.
const CARDS = {
	rows: PANEL.rows,
	text_x: 3,
	lane: 'NEW LANE',
	state: 'STATE',
	count: 'EVENTS ANALYZED',
	settle: 0.55,
}
const CARD_AT = { first: 0.3, second: 0.55, third: 0.85 }
const MARK = /^[A-Z]{2}$/u
// What stands between a lane's number and its title: its priority and its kind's marker.
const LEAD = /^\s*(?:P\d\s+)?(?:(?:\*\*|BG)\s+)?/u
const WIRE = ink(RGB.steel)

// A card: its bold title and the thin line under it; a card with no line wraps its title onto it.
interface Card {
	title: string
	line: string
}

// A card's styles; the stamp's fact takes the same three.
interface ClueInks {
	chip: string
	title: string
	line: string
}

const BRIGHT: ClueInks = { chip: bold(RGB.blue), title: bold(RGB.white), line: ink(RGB.soft) }
// The moment of settling: everything settled flashes white.
const FLASH: ClueInks = { chip: bold(RGB.white), title: bold(RGB.white), line: bold(RGB.white) }

// The new lane's title as its row writes it: what follows its number, its priority and marker.
function title_of(layout: ThemeLayout): string {
	const { new_lane, row_text } = layout
	const at = new_lane === '' ? -1 : row_text.indexOf(new_lane)

	return at < 0
		? ''
		: row_text
				.slice(at + new_lane.length)
				.replace(LEAD, '')
				.trim()
}

// What the board's own layout tells of the new lane, as cards: its number, the state its row starts
// with, its title. One it tells nothing for is left out.
function fields_of(draw: ThemeDraw): Array<Card> {
	const { layout } = draw.api
	const [mark = ''] = layout.row_text.trim().split(/\s+/u, 1)
	const cards = [
		{ title: layout.new_lane === '' ? '' : `#${layout.new_lane}`, line: CARDS.lane },
		{ title: MARK.test(mark) ? mark : '', line: CARDS.state },
		{ title: title_of(layout), line: '' },
	]

	return cards.filter((each) => each.title !== '')
}

// The clue cards: the lane's fields; a pane a row short shows none.
function cards_of(draw: ThemeDraw, pane: Pane): Array<Card> {
	return pane.box.h < CARDS.rows ? [] : fields_of(draw)
}

// The pane's columns of the ticks the cards hang from, left to right.
function card_columns(scrub: Scrub, count: number): Array<number> {
	const every = tick_every(scrub.width)
	const places = Object.values(CARD_AT).slice(0, count)

	return places.map((place) => TIMELINE.track_x + Math.round((scrub.width * place) / every) * every)
}

// A title too long for its card: cut at a word's end, the rest on the line under it.
function wrapped(text: string, room: number): [string, string] {
	const space = text.lastIndexOf(' ', room)
	const cut = space > 0 ? space : room

	return [text.slice(0, cut), text.slice(cut).trim()]
}

// A card over column `x`: a right-angle line up from its tick, a chip, its title and its line.
function card(pane: Pane, spot: { x: number; room: number }, content: Card, inks: ClueInks): void {
	const { x, room } = spot
	const lines = content.line === '' ? wrapped(content.title, room) : [content.title, content.line]

	put_in(pane, { x, y: 0 }, '┌─', WIRE)

	for (let y = 1; y < pane.box.h - 1; y++) put_in(pane, { x, y }, '│', WIRE)

	put_in(pane, { x: x + PAIR, y: 0 }, '▌', inks.chip)
	put_in(pane, { x: x + CARDS.text_x, y: 0 }, (lines[0] ?? '').slice(0, room), inks.title)
	put_in(pane, { x: x + CARDS.text_x, y: 1 }, (lines[1] ?? '').slice(0, room), inks.line)
}

// Whether the head has passed the tick at pane column `x`.
function is_passed(scrub: Scrub, x: number): boolean {
	return scrub.is_done || (!scrub.is_rewinding && scrub.head >= x - TIMELINE.track_x)
}

// The count of events analyzed, by the hints' row's right end.
function events_count(pane: Pane, shown: number, total: number): void {
	const count = `${String(shown)}/${String(total)}`
	const x = pane.box.w - CARDS.count.length - count.length - PAIR
	const y = pane.box.h - PAIR

	put_in(pane, { x, y }, CARDS.count, ink(RGB.soft))
	put_in(pane, { x: x + CARDS.count.length + 1, y }, count, bold(RGB.white))
}

// The cards whose ticks the head has passed, one after another.
function clues(draw: ThemeDraw, scrub: Scrub, inks: ClueInks): void {
	const { pane } = scrub
	const cards = cards_of(draw, pane)
	const columns = card_columns(scrub, cards.length)
	const shown = columns.filter((x) => is_passed(scrub, x))

	for (const [index, x] of shown.entries()) {
		const room = (columns[index + 1] ?? pane.box.w) - x - CARDS.text_x - 1

		card(pane, { x, room }, cards[index] ?? { title: '', line: '' }, inks)
	}
}

// The count of the cards shown of those this lane has, stepping up as each appears; none where the
// pane shows no card.
function tally(draw: ThemeDraw, scrub: Scrub): void {
	const total = cards_of(draw, scrub.pane).length
	const shown = card_columns(scrub, total).filter((x) => is_passed(scrub, x)).length

	if (total > 0) events_count(scrub.pane, shown, total)
}

// The area dimmed: what still moved is dim under what has settled, drawn over it after.
function dim_pane(pane: Pane): void {
	const { x, y, w, h } = pane.box
	const dim = ink(mix(RGB.soft, RGB.night, CARDS.settle))

	restyle(
		pane.grid,
		(_, cell_x, cell_y) => cell_x >= x && cell_x < x + w && cell_y >= y && cell_y < y + h,
		() => dim,
	)
}

const run_board_theme_deviant_replay = {
	BRIGHT,
	FLASH,
	card_columns,
	cards_of,
	clues,
	dim_pane,
	fields_of,
	is_passed,
	tally,
	wrapped,
}

export { run_board_theme_deviant_replay }
export type { ClueInks }
