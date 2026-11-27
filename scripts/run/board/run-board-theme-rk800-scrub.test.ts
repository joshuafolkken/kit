import { describe, expect, it } from 'vitest'
import { run_board_theme_rk800_fixture } from './run-board-theme-rk800-fixture'
import { run_board_theme_rk800_scrub, type Scrub } from './run-board-theme-rk800-scrub'

// joshuafolkken/kit#9096: the rk800 theme's reconstruction scrub — the timeline's head, the
// lane's line-art, the white line down the board and the board sinking into scan blue.

const {
	hints,
	lane_art,
	outline_glyph,
	play_share,
	scan_line,
	scrub_of,
	sink,
	tick_every,
	timeline,
	track_cell,
} = run_board_theme_rk800_scrub
const { HOST, draw_at, row_text, state_at } = run_board_theme_rk800_fixture
// The demo's ROW starts typing on tick 10 and rewinds for twelve ticks before it plays.
const START = 10
const REWINDING = START + 4
const PLAYING = START + 40
const TYPED = 400
const COUNT = '1/3'
// The area's pane: its first row on the board, its last row in the pane.
const PANE_TOP = HOST.layout.area_top + 1
const LAST = 6

function pane_row(scrub: Scrub, y: number): string {
	return row_text(scrub.pane.grid, PANE_TOP + y).slice(0, scrub.pane.box.w)
}

describe('run_board_theme_rk800_scrub.play_share', () => {
	it('plays from the left end once the rewind is over, whole once typed', () => {
		const { row } = state_at('r', PLAYING)

		expect(play_share({ ...row, is_typing: true, length: 12, total: 52 })).toBe(0)
		expect(play_share({ ...row, is_typing: true, length: 32, total: 52 })).toBe(0.5)
		expect(play_share({ ...row, is_typing: false })).toBe(1)
	})
})

describe('run_board_theme_rk800_scrub.scrub_of', () => {
	it('rewinds first, then plays, and is done once the lane has typed', () => {
		const rewinding = scrub_of(draw_at('r', REWINDING), COUNT)
		const done = scrub_of(draw_at('r', TYPED), COUNT)

		expect([rewinding.is_rewinding, rewinding.is_done]).toStrictEqual([true, false])
		expect([done.is_rewinding, done.is_done, done.head]).toStrictEqual([false, true, 49])
		expect(done.width).toBe(50)
	})
})

describe('run_board_theme_rk800_scrub.tick_every', () => {
	it('spaces ten gaps along the track, two cells at the least', () => {
		expect([tick_every(50), tick_every(8)]).toStrictEqual([5, 2])
	})
})

describe('run_board_theme_rk800_scrub.track_cell', () => {
	it('draws the head, the yellow ticks and the line', () => {
		const scrub = scrub_of(draw_at('r', TYPED), COUNT)

		expect(track_cell(scrub.head, scrub)[0]).toBe('●')
		expect(track_cell(5, scrub)[0]).toBe('┃')
		expect(track_cell(6, scrub)[0]).toBe('━')
		expect(track_cell(6, scrub)).not.toStrictEqual(track_cell(6, { ...scrub, head: 0 }))
	})
})

describe('run_board_theme_rk800_scrub.outline_glyph', () => {
	it('dots a field’s ends and dashes between them', () => {
		const cells = [...'ab  cde']

		expect(cells.map((_, index) => outline_glyph(cells, index)).join('')).toBe('··  ·╌·')
	})
})

describe('run_board_theme_rk800_scrub drawing', () => {
	it('lays the timeline with its count on the pane’s last row', () => {
		const scrub = scrub_of(draw_at('r', TYPED), COUNT)

		timeline(scrub, COUNT)
		expect(pane_row(scrub, LAST)).toMatch(/^ {2}L2 .[━┃]+●. R2 .1\/3/u)
	})

	it('shows the rewind’s hint and the lane’s outline while rewinding', () => {
		const draw = draw_at('r', REWINDING)
		const scrub = scrub_of(draw, COUNT)

		hints(draw, scrub)
		lane_art(draw, scrub)
		expect(pane_row(scrub, LAST - 1)).toContain('◀◀ REWIND')
		expect(pane_row(scrub, LAST - 2)).toMatch(/^▌.{5}··/u)
	})

	it('crosses the board with a line at the head’s column while the lane types', () => {
		const draw = draw_at('r', PLAYING)
		const scrub = scrub_of(draw, COUNT)
		const x = 6 + scrub.head

		scan_line(draw, scrub)
		expect(row_text(draw.grid, 3).charAt(x)).toBe('│')
	})

	it('sinks every row but the lanes’', () => {
		const draw = draw_at('r', PLAYING)
		const [lane = 0] = HOST.layout.lane_rows

		sink(draw)
		expect(draw.grid[lane]).toStrictEqual(HOST.board[lane])
		expect(draw.grid[PANE_TOP]).not.toStrictEqual(HOST.board[PANE_TOP])
	})
})
