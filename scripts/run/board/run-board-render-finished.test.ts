import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_layout, type BoardPlan } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemStatus } from './run-board-status'

const { MINUTE, NOW, STARTED, header } = run_board_render_fixture
const ISSUE = 6227
const WIDTH = 120
const TITLE = 'Explain why each finished run needs no further action on the board'
const REASON = 'result recorded on #6227'
const PLAN: BoardPlan = {
	waves: { waves: [], unreached: [] },
	tracked: new Map(),
	context: {
		repo: 'joshuafolkken/kit',
		titles: new Map([[ISSUE, TITLE]]),
		open_numbers: new Set(),
	},
	labels: new Map(),
}

function line_of(state: ItemStatus['state'], reason?: string, columns = WIDTH): string {
	const status = { state, reason, started_ms: STARTED, ended_ms: NOW - MINUTE }
	const layout = run_board_layout.layout_of(PLAN, new Map([[ISSUE, status]]))
	const lines = run_board_render.render({
		header: header({ layout }),
		notes: [],
		size: { columns, rows: WIDTH },
	})

	return stripVTControlCharacters(lines.find((line) => line.includes(String(ISSUE))) ?? '')
}

describe('run_board_render — finished reasons', () => {
	it.each(['withdrawn', 'done'] as const)('ends %s with its reason (ac-0dc7a1df)', (state) => {
		expect(line_of(state, REASON)).toMatch(new RegExp(`nothing to do · ${state}: ${REASON}$`, 'u'))
	})

	it('draws a reason even when done has no recorded reason (ac-660584f1)', () => {
		expect(line_of('done')).toMatch(/nothing to do · done: closed without a PR to merge$/u)
	})

	it('preserves a merged row without adding a reason (ac-6fb88544)', () => {
		expect(line_of('merged')).toBe(
			'    ✅ 10-08 18:09 6227       Explain why each finished run needs no further …  2°09′00″',
		)
		expect(line_of('merged')).not.toContain('nothing to do')
	})

	it.each(['withdrawn', 'done'] as const)('shortens the %s title before its reason', (state) => {
		const line = line_of(state, REASON)

		expect(line).toMatch(/… {2}.*nothing to do/u)
		expect(line.endsWith(REASON)).toBe(true)
		expect(run_board_fit.width_of(line)).toBeLessThanOrEqual(WIDTH)
	})
})
