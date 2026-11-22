import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_spot } from './run-board-spot'

// joshuafolkken/kit#8003: a spinner's placeholder, one column wide, drawn as a frame.

const { SPOT, drawn } = run_board_spot

describe('run_board_spot', () => {
	it('draws every placeholder in a line as the frame and leaves a line with none as it was', () => {
		expect(drawn(`${SPOT} run ${SPOT}`, '⠋')).toBe('⠋ run ⠋')
		expect(drawn('still', '⠋')).toBe('still')
	})

	it('takes one column, as a spinner frame does', () => {
		expect(run_board_fit.width_of(SPOT)).toBe(run_board_fit.width_of('⠋'))
	})

	it('restores the TRACE initial without changing the fitted width', () => {
		const marked = `${run_board_spot.TRACE}RACE ■■■■■`

		expect(drawn(marked, '')).toBe('TRACE ■■■■■')
		expect(run_board_fit.width_of(marked)).toBe(run_board_fit.width_of(drawn(marked, '')))
	})
})
