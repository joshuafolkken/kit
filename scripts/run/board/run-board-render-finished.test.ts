import { stripVTControlCharacters } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

function board_of(state: ItemStatus['state'], reason?: string, columns = WIDTH): Array<string> {
	const status = { state, reason, started_ms: STARTED, ended_ms: NOW - MINUTE }
	const layout = run_board_layout.layout_of(PLAN, new Map([[ISSUE, status]]))
	const lines = run_board_render.render({
		header: header({ layout }),
		notes: [],
		size: { columns, rows: WIDTH },
	})

	return lines.map((line) => stripVTControlCharacters(line))
}

function line_of(state: ItemStatus['state'], reason?: string, columns = WIDTH): string {
	return board_of(state, reason, columns).find((line) => line.includes(String(ISSUE))) ?? ''
}

describe('run_board_render — finished reasons', () => {
	beforeEach(() => {
		vi.stubEnv('TZ', 'UTC')
	})
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it.each(['withdrawn', 'done'] as const)('ends %s with its reason (ac-0dc7a1df)', (state) => {
		expect(line_of(state, REASON)).toMatch(new RegExp(`nothing to do · ${state}: ${REASON}$`, 'u'))
	})

	it('draws a reason even when done has no recorded reason (ac-660584f1)', () => {
		expect(line_of('done')).toMatch(/nothing to do · done: closed without a PR to merge$/u)
	})

	// joshuafolkken/kit#7095: an issue `josh issue:already-done` closed — ⏩ in the done section, not 🏁.
	it('draws an already-done row with ⏩ and its own tail, apart from a done one (ac-38bbacca)', () => {
		const line = line_of('already_done')

		expect(line).toMatch(/^\s+⏩ /u)
		expect(line).not.toContain('🏁')
		expect(line).toMatch(/nothing to do · already done: closed with verified evidence$/u)
	})

	it('preserves a merged row without adding a reason (ac-6fb88544)', () => {
		expect(line_of('merged')).toBe(
			'    ✅ 10-08 11:09 6227       Explain why each finished run needs no further …  2°09′00″',
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

// joshuafolkken/kit#7095: an already-done row is finished as a done one is — drawn under the done heading.
describe('run_board_render — already done finishes as done does (ac-932de729)', () => {
	it.each(['done', 'already_done'] as const)('draws a %s row under the done heading', (state) => {
		const lines = board_of(state)
		const heading = lines.findIndex((line) => line.includes('✅ done'))

		expect(run_board_layout.is_finished(state)).toBe(true)
		expect(heading).toBeGreaterThan(-1)
		expect(lines.findIndex((line) => line.includes(String(ISSUE)))).toBeGreaterThan(heading)
	})
})
