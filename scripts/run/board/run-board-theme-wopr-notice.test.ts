import { describe, expect, it } from 'vitest'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'
import { run_board_theme_wopr_fixture } from './run-board-theme-wopr-fixture'
import { run_board_theme_wopr_notice } from './run-board-theme-wopr-notice'

const { INK, SPARK } = run_board_theme_wopr_data
const { WOPR, board_grid, row_text, state_at } = run_board_theme_wopr_fixture
const { closing, darken, flash, header_lines, notice_event, notice_pace, whole_style } =
	run_board_theme_wopr_notice

// The demo's NOTICE peaks at tick 89: c ticks after the peak.
function after_peak(cooled: number): number {
	return 89 + cooled
}

function lines_at(cooled: number): Array<string> {
	const tick = after_peak(cooled)

	return header_lines(WOPR, state_at('n', tick), tick)
}

describe('run_board_theme_wopr_notice — its pace, its frames and its header', () => {
	it('plays the first game a move a tick, the next two at two, the rest at three', () => {
		expect([0, 1, 2, 3].map((game) => notice_pace(game))).toStrictEqual([1, 0.5, 0.5, 1 / 3])
	})

	it('sparks, then whites out each war’s last ticks', () => {
		expect(whole_style(WOPR, 0)).toBe(SPARK[0])
		expect(whole_style(WOPR, 4)).toBeUndefined()
		// The first war runs c 4 to 21, white its last three.
		expect(whole_style(WOPR, 21)).toBe(INK.white_out)
	})

	it('carries the match, then the war, in the header', () => {
		expect(lines_at(-30)[0]).toBe('WOPR · LAUNCH CODE')
		expect(lines_at(2)[1]).toContain('CPE 1704')
		expect(lines_at(10)[2]).toBe('WINNER: NONE')
	})
})

describe('run_board_theme_wopr_notice — the screen', () => {
	it('types the film’s last lines in the dark, dimming the rest', () => {
		const grid = board_grid()
		const state = state_at('n', after_peak(160))

		closing(WOPR, grid, state)
		darken(grid, state)

		expect(row_text(grid, WOPR.closing.y)).toContain('A STRANGE GAME.')
		expect(grid.flat().some(([, style]) => style === INK.dark)).toBe(true)
	})

	it('burns the whole screen at the spark', () => {
		const grid = board_grid()

		flash(WOPR, grid, state_at('n', after_peak(0)))

		expect(grid.flat().every(([, style]) => style === SPARK[0])).toBe(true)
	})

	it('plays only from the notice to its effect’s end', () => {
		expect(notice_event(WOPR, board_grid(), state_at('i', 20), 20)).toBe(false)
		expect(notice_event(WOPR, board_grid(), state_at('n', 20), 20)).toBe(true)
	})
})
