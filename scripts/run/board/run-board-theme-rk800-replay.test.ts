import { describe, expect, it } from 'vitest'
import { run_board_theme_draw } from './run-board-theme-draw'
import { run_board_theme_rk800_fixture } from './run-board-theme-rk800-fixture'
import { run_board_theme_rk800_replay } from './run-board-theme-rk800-replay'
import { run_board_theme_rk800_scrub } from './run-board-theme-rk800-scrub'

// joshuafolkken/kit#9096: the rk800 theme's clue cards inside a ROW's area.

const { BRIGHT, card_columns, cards_of, clues, dim_pane, fields_of, is_passed, tally, wrapped } =
	run_board_theme_rk800_replay
const { scrub_of } = run_board_theme_rk800_scrub
const { data_pane } = run_board_theme_draw
const { HOST, draw_at, row_text } = run_board_theme_rk800_fixture
const TYPED = 400
const COUNT = '1/3'
const PANE_TOP = HOST.layout.area_top + 1
const CARD_COLUMNS = [21, 36, 51]

describe('run_board_theme_rk800_replay.fields_of', () => {
	it('tells the new lane’s number, its state and its title', () => {
		const fields = fields_of(draw_at('r', TYPED))

		expect(fields.map(({ line }) => line)).toStrictEqual(['NEW LANE', 'STATE', ''])
		expect(fields.map(({ title }) => title).slice(0, 2)).toStrictEqual(['#8826', 'BD'])
		expect(fields[2]?.title).toMatch(/^Add a cell back buffer/u)
	})
})

describe('run_board_theme_rk800_replay.cards_of', () => {
	it('shows the cards on a pane with all its rows, none on a shorter one', () => {
		const draw = draw_at('r', TYPED)
		const pane = data_pane(draw)
		const short = { ...pane, box: { ...pane.box, h: pane.box.h - 1 } }

		expect(cards_of(draw, pane)).toHaveLength(3)
		expect(cards_of(draw, short)).toStrictEqual([])
	})
})

describe('run_board_theme_rk800_replay.card_columns', () => {
	it('hangs the cards from ticks along the track', () => {
		const scrub = scrub_of(draw_at('r', TYPED), COUNT)

		expect(card_columns(scrub, 3)).toStrictEqual(CARD_COLUMNS)
		expect(card_columns(scrub, 1)).toStrictEqual(CARD_COLUMNS.slice(0, 1))
	})
})

describe('run_board_theme_rk800_replay.wrapped', () => {
	it('cuts at a word’s end, else at the room', () => {
		expect(wrapped('Add a cell back', 10)).toStrictEqual(['Add a cell', 'back'])
		expect(wrapped('overall', 4)).toStrictEqual(['over', 'all'])
	})
})

describe('run_board_theme_rk800_replay.is_passed', () => {
	it('is passed once the head is past the tick, never while it rewinds', () => {
		const scrub = { ...scrub_of(draw_at('r', TYPED), COUNT), is_done: false, head: 20 }

		expect([is_passed(scrub, 26), is_passed(scrub, 27)]).toStrictEqual([true, false])
		expect(is_passed({ ...scrub, is_rewinding: true }, 7)).toBe(false)
	})
})

describe('run_board_theme_rk800_replay drawing', () => {
	it('draws every card and the count once the lane has typed', () => {
		const draw = draw_at('r', TYPED)
		const scrub = scrub_of(draw, COUNT)

		clues(draw, scrub, BRIGHT)
		tally(draw, scrub)
		expect(row_text(draw.grid, PANE_TOP)).toMatch(/┌─▌#8826.*┌─▌BD.*┌─▌Add/u)
		expect(row_text(draw.grid, PANE_TOP + 1)).toContain('NEW LANE')
		expect(row_text(draw.grid, PANE_TOP + 5)).toContain('EVENTS ANALYZED 3/3')
	})

	it('dims the pane’s cells only', () => {
		const draw = draw_at('r', TYPED)

		dim_pane(data_pane(draw))
		expect(draw.grid[PANE_TOP]).not.toStrictEqual(HOST.board[PANE_TOP])
		expect(draw.grid[0]).toStrictEqual(HOST.board[0])
	})
})
