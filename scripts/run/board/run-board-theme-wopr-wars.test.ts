import { describe, expect, it } from 'vitest'
import { run_board_theme_wopr_fixture } from './run-board-theme-wopr-fixture'
import { run_board_theme_wopr_wars } from './run-board-theme-wopr-wars'

const { WOPR } = run_board_theme_wopr_fixture
const { impacts, in_air, on_screen, table_at, war_at, war_lengths, white_ticks } =
	run_board_theme_wopr_wars

describe('run_board_theme_wopr_wars', () => {
	it('fights sixteen wars, ever faster, from c 4 up to the ending at c 147', () => {
		const lengths = war_lengths()

		expect(lengths).toStrictEqual([18, 15, 12, 10, 9, 8, 7, 7, 7, 7, 7, 7, 7, 7, 7, 8])
		expect(lengths.reduce((sum, each) => sum + each, 0)).toBe(147 - 4)
	})

	it('runs each war straight after the last', () => {
		const { wars } = WOPR
		const ends = wars.map((war) => war.start + war.length)

		expect(wars.slice(1).map((war) => war.start)).toStrictEqual(ends.slice(0, -1))
		expect(war_at(wars, 4)).toBe(wars[0])
		expect(war_at(wars, 147)).toBeUndefined()
	})

	it('whites out three ticks, two in a war under ten ticks', () => {
		expect(white_ticks({ start: 0, length: 10, tracks: [], blobs: [] })).toBe(3)
		expect(white_ticks({ start: 0, length: 9, tracks: [], blobs: [] })).toBe(2)
	})

	it('counts missiles in the air and landed', () => {
		expect(in_air(WOPR.wars, 0)).toBe(0)
		expect(impacts(WOPR.wars, 0)).toBe(0)
		expect(impacts(WOPR.wars, 146)).toBe(WOPR.wars.reduce((sum, war) => sum + war.tracks.length, 0))
	})

	it('pages the table from c 4, its rows ever closer, a tick apart at last', () => {
		const ticks = table_at()

		expect(ticks.slice(0, 3)).toStrictEqual([4, 12, 18])
		expect(ticks.at(-1)).toBe(146)
	})

	it('keeps the screen blobs off the notice', () => {
		const { notice } = WOPR.api.layout

		expect(on_screen(WOPR, notice.y, notice.x)).toBe(false)
		expect(on_screen(WOPR, -1, 0)).toBe(false)
	})
})
