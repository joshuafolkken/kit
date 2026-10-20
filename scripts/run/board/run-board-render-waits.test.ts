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
// own row — 🚧 leading it, why and how long in its elapsed column (#4292), which check at its end — and a wait no row owns on one
// line right before the legend, so a wait coming and going moves no line under the header.

const { EMPTY_LAYOUT, MINUTE, NOW, header, lines_of } = run_board_render_fixture
const { BUDGET_ICON } = run_board_render_waits
const LANE = 4039
const NARROW_COLUMNS = 40
const HELD_LEGEND = '🚧 held'
const CPU_LEGEND = '💪 waits for CPU'

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

describe('run_board_render_waits.stray_lines', () => {
	it('draws the reason’s header icon, the wait as a length and the check’s short name', () => {
		const { stray_lines } = run_board_render_waits
		const waits = [
			wait(),
			wait({ reason: 'cores', command: 'gate test' }),
			wait({ reason: 'memory', command: undefined }),
			wait({ command: 'test:related', waited_ms: 75_000 }),
		].map((extra) => ({ ...extra, lane: undefined }))

		expect(stray_lines(header({ budget_waits: waits }))).toStrictEqual([
			'  🚧 🧠 9″ lint main',
			'  🚧 💪 9″ test main',
			'  🚧 🧠 9″ step main',
			'  🚧 🧠 1′15″ test main',
		])
	})

	it('draws an icon no phase, state or header line already uses', () => {
		const { HEADER_ICONS, PHASE_ICONS, STATE_ICONS } = run_board_labels
		const icons = [HEADER_ICONS, PHASE_ICONS, STATE_ICONS].flatMap((table) => Object.values(table))

		expect(icons).not.toContain(BUDGET_ICON)
	})
})

// joshuafolkken/kit#4292: a held lane's reason and time fill the whole-elapsed column of its row.
describe('run_board_render_waits.held_time', () => {
	const { held_time } = run_board_render_waits

	it('right-aligns the time so the reason and the time fill the column', () => {
		expect(held_time(wait({ reason: 'cores', waited_ms: 43_000 }), 8)).toBe('💪   43″')
		expect(held_time(wait({ reason: 'memory', waited_ms: 65_000 }), 8)).toBe('🧠 1′05″')
	})

	it('draws a hold too long for the column to the minute, so it stays eight columns wide', () => {
		const held = held_time(wait({ reason: 'cores', waited_ms: 605_000 }), 8)

		expect(held).toBe('💪   11′')
		expect(run_board_fit.width_of(held)).toBe(8)
	})
})

describe('run_board_render.render — a held lane on its row', () => {
	it('leads the row with 🚧, keeps the phase’s icon, holds the elapsed column and ends on the check', () => {
		expect(lane_line([wait()])).toMatch(/^ {2}🚧 🔨 +11′00″ 🧠 +9″ 4039 {4}Issue 4039 +lint$/u)
	})

	it('draws the phase icon and the run’s time again once the wait is gone', () => {
		const line = lane_line([])

		expect(line).toMatch(/^ {5}🔨 +11′00″ +15′00″ 4039 /u)
		expect(line).not.toContain(BUDGET_ICON)
	})

	it('draws nothing under the header for a lane’s wait', () => {
		const lines = plain_lines([wait()])

		const drawn = lines.filter((line) => line.includes(BUDGET_ICON) && !line.includes(HELD_LEGEND))

		expect(drawn).toStrictEqual([lane_line([wait()])])
	})
})

describe('run_board_render.render — a wait no row owns', () => {
	const stray = [
		wait({ lane: undefined, reason: 'cores', command: 'check', waited_ms: 3000 }),
		wait({ lane: undefined, elsewhere: '.app-kit-lanes/12', command: 'audit', waited_ms: 0 }),
	]
	const drawn = ['  🚧 💪 3″ check main', '  🚧 🧠 0″ audit .app-kit-lanes/12']

	it('draws each on one line right before the legend, after the plan', () => {
		const lines = plain_lines(stray)
		const at = lines.indexOf(drawn[0] ?? '')
		const legend = lines.slice(at + drawn.length).join('\n')

		expect(at).toBeGreaterThan(lines.indexOf(lane_line(stray)))
		expect(lines.slice(at - 1, at + drawn.length)).toStrictEqual(['', ...drawn])
		expect(legend).toContain(HELD_LEGEND)
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

		expect(legend).toContain('🚧 held  🧠 waits for memory')
		expect(legend).not.toContain(CPU_LEGEND)
		expect(legend).toContain('🔨 implement')
	})

	it('draws a lane’s longest wait and names only its reason where its lane waits twice', () => {
		const waits = [wait({ waited_ms: 2000 }), wait({ reason: 'cores', command: 'gate test' })]
		const lines = plain_lines(waits)

		expect(lane_line(waits)).toMatch(/💪 +9″ 4039 .*test$/u)
		expect(lines.join('\n')).toContain(CPU_LEGEND)
		expect(lines.join('\n')).not.toContain('🧠 waits for memory')
	})

	it('names no held check on a frame with no wait', () => {
		expect(plain_lines([]).join('\n')).not.toContain(HELD_LEGEND)
	})
})

function draw({ title_limit }: RowCut): string {
	return `${'x'.repeat(title_limit)}  🧠 9″ lint`
}

describe('run_board_render_title.fitted — a held row on a narrow pane', () => {
	it('gives up title columns to keep its wait, where a row with neither wraps', () => {
		const row = running(LANE)
		const { fitted } = run_board_render_title

		expect(run_board_fit.width_of(fitted(row, NARROW_COLUMNS, draw, { is_line_kept: true }))).toBe(
			NARROW_COLUMNS,
		)
		expect(fitted(row, NARROW_COLUMNS, draw)).toBe(draw(run_board_render_title.WHOLE))
	})
})
