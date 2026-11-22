import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardRow } from './run-board-layout'
import { run_board_render_legend } from './run-board-render-legend'

// joshuafolkken/kit#8510: the legend is drawn at the frame's own brightness, never dimmed — with color
// forced, so a dim escape would be written were it styled.

const DIM = '\u{1B}[2m'
const PARKED: BoardRow = {
	number: 1,
	title: 'Issue 1',
	state: 'parked',
	status: undefined,
	kind: 'bug',
	waits: [],
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_render_legend.legend_of brightness', () => {
	it('draws the legend with no dim escape where color is forced', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const leads = new Set(['💤'])
		const whole = { leads, icons: leads, named: [], checks: [], held: [], solo: false }

		const drawn = run_board_render_legend.legend_of([PARKED], whole, [])

		expect(drawn).toStrictEqual(['💤 parked  🐛 fix'])
		expect(drawn.join('')).not.toContain(DIM)
	})
})
