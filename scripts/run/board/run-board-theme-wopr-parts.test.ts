import { describe, expect, it } from 'vitest'
import { run_board_theme_wopr_fixture } from './run-board-theme-wopr-fixture'
import { run_board_theme_wopr_parts } from './run-board-theme-wopr-parts'

const { HOST, WOPR, board_grid, row_text, state_at } = run_board_theme_wopr_fixture
const { BEATS, ending_of, opening_of } = run_board_theme_wopr_parts

describe('run_board_theme_wopr_parts.opening_of', () => {
	const opening = opening_of(WOPR)

	it('types SHALL WE PLAY A GAME?, holds, then writes the board a line a beat', () => {
		expect(opening.ticks).toBe(61 + Math.ceil((HOST.layout.h * 75) / 50) + 2)
	})

	it('types the question behind a block', () => {
		const grid = board_grid()

		opening.draw(grid, 4, state_at('i', 4))

		expect(row_text(grid, 0).trimEnd()).toBe('SHALL█')
		expect(row_text(grid, 1).trim()).toBe('')
	})

	// joshuafolkken/kit#9137: the opening's lamps are out in their rows' own out shades.
	it('draws the lamps out, a yellow row’s in yellow halved and a red row’s in red halved', () => {
		const grid = board_grid()
		const { x, top } = WOPR.lamps

		opening.draw(grid, opening.ticks - 1, state_at('i', opening.ticks - 1))

		expect(grid[top]?.[x]?.[1]).toContain('128;107;5')
		expect(grid[top + 3]?.[x]?.[1]).toContain('128;38;40')
	})

	it('writes nothing past the rows it has reached', () => {
		const grid = board_grid()

		opening.draw(grid, 61, state_at('i', 61))

		expect(row_text(grid, HOST.layout.h - 1).trim()).toBe('')
	})
})

describe('run_board_theme_wopr_parts.ending_of', () => {
	const ending = ending_of(WOPR)

	// joshuafolkken/kit#9137: the empty screen holds a second, as every theme's ending does.
	it('lasts until the screen has been empty twenty ticks', () => {
		expect(ending.ticks).toBe(46 + 31 + 30 + 20)
	})

	it('marks the beats its one-shot sounds fall on', () => {
		expect(BEATS).toStrictEqual({ reveal: 61, dark: 40, words: 46, empty: 46 + 31 + 30 })
	})

	// joshuafolkken/kit#8917: the ending's sound hears its last line as the opening's — the trill while
	// it types, the typed end once through.
	it('sounds the trill while the last line types and its typed end once through', () => {
		expect(ending.typing).toStrictEqual({
			spans: [{ from_ms: 2300, to_ms: 3850 }],
			typed_ms: 3850,
		})
	})

	it('takes the board away from the bottom up', () => {
		const grid = board_grid()

		ending.draw(grid, 30, state_at('i', 30))

		expect(row_text(grid, 0).trim()).not.toBe('')
		expect(row_text(grid, WOPR.last_row).trim()).toBe('')
	})

	it('types WOPR’s last line at the top left', () => {
		const grid = board_grid()

		ending.draw(grid, 50, state_at('i', 50))

		expect(row_text(grid, 0).trimEnd()).toBe('HOW A█')
	})
})
