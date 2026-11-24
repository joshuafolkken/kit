import { describe, expect, it } from 'vitest'
import { board_compare_screen } from './board-compare-screen'

const SIZE = { columns: 4, rows: 2 }
const ESC = '\u{1B}['
const TICK_MS = 50

describe('board_compare_screen.shots_of', () => {
	it('reads each beat at the sum of the waits before it', async () => {
		const shots = await board_compare_screen.shots_of(
			[
				{ text: 'a', ms: TICK_MS },
				{ text: 'b', ms: TICK_MS },
			],
			SIZE,
		)

		expect(shots.map((shot) => shot.at_ms)).toStrictEqual([0, TICK_MS])
		expect(shots.map((shot) => shot.cells[0]?.map((cell) => cell.char).join(''))).toStrictEqual([
			'a   ',
			'ab  ',
		])
	})

	it('reads the colors and attributes of a cell', async () => {
		const [shot] = await board_compare_screen.shots_of([{ text: `${ESC}1;4;31;42mx`, ms: 0 }], SIZE)

		expect(shot?.cells[0]?.[0]).toStrictEqual({
			char: 'x',
			fg: '16777216:1',
			bg: '16777216:2',
			style: 'bu',
		})
		expect(shot?.cells[0]?.[1]).toStrictEqual({ char: ' ', fg: '0:-1', bg: '0:-1', style: '' })
	})
})
