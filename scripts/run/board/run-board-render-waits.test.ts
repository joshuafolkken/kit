import { stripVTControlCharacters } from 'node:util'
import type { BudgetWait } from '#scripts/gate/core-wait'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_title, type RowCut } from './run-board-render-title'
import { run_board_render_waits } from './run-board-render-waits'

// joshuafolkken/kit#3943: a claim waiting in the core budget was on no board, so a lane held back by
// memory pressure read the same as a stuck one. joshuafolkken/kit#4052: a lane's wait is drawn on its
// own row — 🚧 leading it, why, how long and which check at its end — and a wait no row owns on one
// line right before the legend, so a wait coming and going moves no line under the header.

const { EMPTY_LAYOUT, MINUTE, NOW, header, lines_of } = run_board_render_fixture
const { BUDGET_ICON } = run_board_render_waits
const LANE = 4039
const NARROW_COLUMNS = 40
const HELD_CHECK = 'held check'

function wait(extra: Partial<BudgetWait> = {}): BudgetWait {
	return {
		command: 'lint:related',
		lane: String(LANE),
		elsewhere: undefined,
		waited_ms: 9000,
		reason: 'pressure',
		...extra,
	}
}

function running(number: number): BoardRow {
	const status = {
		state: 'running' as const,
		started_ms: NOW - 15 * MINUTE,
		track: ['implement' as const],
		phase_ms: NOW - 11 * MINUTE,
	}

	return {
		number,
		title: `Issue ${String(number)}`,
		kind: undefined,
		state: 'running',
		status,
		waits: [],
	}
}

function board(waits: ReadonlyArray<BudgetWait>): BoardHeader {
	return header({ layout: { ...EMPTY_LAYOUT, active: [running(LANE)] }, budget_waits: waits })
}

function plain_lines(waits: ReadonlyArray<BudgetWait>): Array<string> {
	return lines_of(board(waits)).map((line) => stripVTControlCharacters(line))
}

function lane_line(waits: ReadonlyArray<BudgetWait>): string {
	return plain_lines(waits).find((line) => line.includes(`Issue ${String(LANE)}`)) ?? ''
}

describe('run_board_render_waits.held_text', () => {
	it('draws the reason’s header icon, the wait as a length and the check’s short name', () => {
		const { held_text } = run_board_render_waits

		expect(held_text(wait(), 0)).toBe('🧠 9″ lint')
		expect(held_text(wait({ reason: 'cores', command: 'gate test' }), 0)).toBe('⚡ 9″ test')
		expect(held_text(wait({ reason: 'memory', command: undefined }), 4)).toBe('🧠   9″ step')
		expect(held_text(wait({ command: 'test:related', waited_ms: 75_000 }), 0)).toBe('🧠 1′15″ test')
	})

	it('draws an icon no phase, state or header line already uses', () => {
		const { HEADER_ICONS, PHASE_ICONS, STATE_ICONS } = run_board_labels
		const icons = [HEADER_ICONS, PHASE_ICONS, STATE_ICONS].flatMap((table) => Object.values(table))

		expect(icons).not.toContain(BUDGET_ICON)
	})
})

describe('run_board_render.render — a held lane on its row', () => {
	it('leads the row with 🚧 and ends it on the wait, keeping the phase’s icon', () => {
		expect(lane_line([wait()])).toMatch(/🚧 4039 {4}Issue 4039 .*🔨 11′00″ · 🧠 9″ lint$/u)
	})

	it('draws the phase icon and the newest activity again once the wait is gone', () => {
		const line = lane_line([])

		expect(line).toMatch(/🔨 4039 /u)
		expect(line).not.toContain(BUDGET_ICON)
	})

	it('draws nothing under the header for a lane’s wait', () => {
		const lines = plain_lines([wait()])

		const drawn = lines.filter((line) => line.includes(BUDGET_ICON) && !line.includes(HELD_CHECK))

		expect(drawn).toStrictEqual([lane_line([wait()])])
	})
})

describe('run_board_render.render — a wait no row owns', () => {
	const stray = [
		wait({ lane: undefined, reason: 'cores', command: 'check', waited_ms: 3000 }),
		wait({ lane: undefined, elsewhere: '.app-kit-lanes/12', command: 'audit', waited_ms: 0 }),
	]
	const drawn = ['  🚧 ⚡ 3″ check main', '  🚧 🧠 0″ audit .app-kit-lanes/12']

	it('draws each on one line right before the legend, after the plan', () => {
		const lines = plain_lines(stray)
		const at = lines.indexOf(drawn[0] ?? '')
		const legend = lines.slice(at + drawn.length).join('\n')

		expect(at).toBeGreaterThan(lines.indexOf(lane_line(stray)))
		expect(lines.slice(at - 1, at + drawn.length)).toStrictEqual(['', ...drawn])
		expect(legend).toContain(HELD_CHECK)
	})

	it('adds nothing under the header', () => {
		const lines = plain_lines(stray)
		const without = plain_lines([])
		const above = lines.slice(0, lines.indexOf(lane_line(stray)))
		const plain_row = lane_line([])

		expect(above).toStrictEqual(without.slice(0, without.indexOf(plain_row)))
	})

	it('draws a lane no running row stands for as its number', () => {
		expect(plain_lines([wait({ lane: '12' })])).toContain('  🚧 🧠 9″ lint 12')
	})
})

describe('run_board_render.render — the held check’s legend', () => {
	it('names 🚧 and only the reasons the frame draws', () => {
		const legend = plain_lines([wait()]).slice(-2).join('\n')

		expect(legend).toContain('🚧 held check  🧠 memory')
		expect(legend).not.toContain('⚡ cores')
		expect(legend).toContain('🔨 implement')
	})

	it('draws a lane’s longest wait and names only its reason where its lane waits twice', () => {
		const waits = [wait({ waited_ms: 2000 }), wait({ reason: 'cores', command: 'gate test' })]
		const lines = plain_lines(waits)

		expect(lane_line(waits)).toMatch(/⚡ 9″ test$/u)
		expect(lines.join('\n')).toContain('⚡ cores')
		expect(lines.join('\n')).not.toContain('🧠 memory')
	})

	it('names no held check on a frame with no wait', () => {
		expect(plain_lines([]).join('\n')).not.toContain(HELD_CHECK)
	})
})

function draw({ title_limit }: RowCut): string {
	return `${'x'.repeat(title_limit)} · 🧠 9″ lint`
}

describe('run_board_render_title.fitted — a held row on a narrow pane', () => {
	it('gives up title columns to keep its wait, where a row with neither wraps', () => {
		const row = running(LANE)
		const { fitted } = run_board_render_title

		expect(run_board_fit.width_of(fitted(row, NARROW_COLUMNS, draw, true))).toBe(NARROW_COLUMNS)
		expect(fitted(row, NARROW_COLUMNS, draw)).toBe(draw(run_board_render_title.WHOLE))
	})
})
