import { describe, expect, it } from 'vitest'
import { run_board_jump } from './run-board-jump'
import { run_board_jump_figure } from './run-board-jump-figure'
import type { PanelCell } from './run-board-panel-draw'

// joshuafolkken/kit#8677: the animation area's own cells through the bttf jump and arrival.

const { figure_look } = run_board_jump_figure
const { TICK_MS, WASH_TICKS } = run_board_jump
const LAMP: PanelCell = { row: 2, column: 3, text: '●', fg: { rgb: '250;55;70', named: 'red' } }
const NAMED: PanelCell = { row: 2, column: 4, text: '─', fg: 'yellow' }
const RUN = { start_ms: 0, letters: 10 }

function jump_at(tick: number): { ms: number; is_burst: boolean; jump: typeof RUN } {
	return { ms: (tick + RUN.letters) * TICK_MS, is_burst: false, jump: RUN }
}

describe('run_board_jump_figure.figure_look', () => {
	it('leaves the cells as they are with neither a jump nor an arrival', () => {
		const cells = [LAMP, NAMED]

		expect(figure_look(cells, { ms: 0, is_burst: false })).toBe(cells)
	})

	it('keeps its own light through the run up and the wash', () => {
		expect(figure_look([LAMP], jump_at(-5))).toStrictEqual([LAMP])
		expect(figure_look([LAMP], jump_at(0))).toStrictEqual([LAMP])
	})

	it('thaws from ice with the board once the wash is over, its palette fallback kept', () => {
		expect(figure_look([LAMP], jump_at(WASH_TICKS))).toStrictEqual([
			{ ...LAMP, fg: { rgb: '190;235;255', named: 'red' } },
		])
	})

	it('goes dark at the start of the arrival', () => {
		const at = { ms: 1000, is_burst: false, arrive_ms: 1000 }

		expect(figure_look([LAMP], at)).toStrictEqual([{ ...LAMP, fg: { rgb: '0;0;0', named: 'red' } }])
	})

	it('leaves a cell with no 24-bit color of its own as it is', () => {
		const at = { ms: 1000, is_burst: false, arrive_ms: 1000 }

		expect(figure_look([NAMED], at)).toStrictEqual([NAMED])
	})
})
