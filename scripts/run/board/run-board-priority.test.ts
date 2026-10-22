import type { EpicChild } from '#scripts/epic/epic-graph'
import { describe, expect, it } from 'vitest'
import { run_board_kind, type BoardPriority } from './run-board-kind'
import {
	run_board_layout,
	type BoardLayout,
	type BoardPlan,
	type BoardRow,
} from './run-board-layout'
import { run_board_priority } from './run-board-priority'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#4383: a row draws its priority between its number and its kind — 🚨 critical,
// 🔺 high, two blanks otherwise — so every title starts in one column, and the header's ⏳ count names
// the priorities waiting among it.

const { EMPTY_LAYOUT, header, lines_of } = run_board_render_fixture
const { cell_of, tally_of } = run_board_priority
const HIGH_LABEL = 'priority:high'
const CRITICAL_LABEL = 'priority:critical'
const CRITICAL = 4390
const HIGH = 4382
const NORMAL = 4356
const DONE = 4373

function row(
	number: number,
	priority?: BoardPriority,
	state: BoardRow['state'] = 'waiting',
): BoardRow {
	return {
		number,
		title: `Title of ${String(number)}`,
		kind: 'bug',
		priority,
		state,
		status: undefined,
		waits: [],
	}
}

function queued(rows: ReadonlyArray<BoardRow>): BoardLayout {
	return { ...EMPTY_LAYOUT, queued: rows.map((entry) => ({ kind: 'row', row: entry })) }
}

function board_lines(): Array<string> {
	const layout = queued([row(CRITICAL, 'critical'), row(HIGH, 'high'), row(NORMAL)])

	return lines_of(header({ layout }))
}

function line_of(lines: ReadonlyArray<string>, number: number): string {
	return lines.find((line) => line.includes(String(number))) ?? ''
}

function title_column(lines: ReadonlyArray<string>, number: number): number {
	return line_of(lines, number).indexOf('Title')
}

describe('run_board_kind.priority_of', () => {
	it('reads critical over high, and nothing from a normal or unread issue', () => {
		expect(run_board_kind.priority_of([HIGH_LABEL, CRITICAL_LABEL])).toBe('critical')
		expect(run_board_kind.priority_of(['bug', HIGH_LABEL])).toBe('high')
		expect(run_board_kind.priority_of(['bug'])).toBeUndefined()
		expect(run_board_kind.priority_of(undefined)).toBeUndefined()
	})
})

describe('run_board_layout.layout_of — the priority', () => {
	it('gives a queued plan row and an active row the priority their labels carry', () => {
		const repo = 'joshuafolkken/kit'
		const queued_child: EpicChild = {
			number: CRITICAL,
			repo,
			state: 'OPEN',
			labels: [CRITICAL_LABEL],
			blocked_by: [],
		}
		const plan: BoardPlan = {
			waves: { waves: [[queued_child]], unreached: [] },
			tracked: new Map(),
			context: { repo, titles: new Map(), open_numbers: new Set([CRITICAL]) },
			labels: new Map([[DONE, [HIGH_LABEL]]]),
		}
		const statuses = new Map<number, ItemStatus>([[DONE, { state: 'merged', started_ms: 1 }]])
		const layout = run_board_layout.layout_of(plan, statuses)

		expect(run_board_layout.rows_of(layout).map((entry) => entry.priority)).toStrictEqual([
			'high',
			'critical',
		])
	})
})

describe('run_board_priority.cell_of', () => {
	it('draws 🚨, 🔺 or two blanks', () => {
		expect(cell_of(row(CRITICAL, 'critical'))).toBe('🚨')
		expect(cell_of(row(HIGH, 'high'))).toBe('🔺')
		expect(cell_of(row(NORMAL))).toBe('  ')
	})
})

describe('run_board_priority.tally_of', () => {
	it('counts the waiting rows by priority, critical first', () => {
		const rows = [row(CRITICAL, 'critical'), row(HIGH, 'high'), row(1, 'high'), row(NORMAL)]

		expect(tally_of(queued(rows))).toBe(' (🚨 1 🔺 2)')
	})

	it('names only the priorities present and leaves out running and settled rows', () => {
		const active = [row(CRITICAL, 'critical', 'running'), row(DONE, 'critical', 'merged')]
		const layout = { ...queued([row(HIGH, 'high')]), active }

		expect(tally_of(layout)).toBe(' (🔺 1)')
	})

	it('draws nothing when no waiting row has a priority', () => {
		const layout = queued([row(NORMAL)])

		expect(tally_of(layout)).toBe('')
	})
})

describe('run_board_render.render — the priority column', () => {
	it('draws the priority between the number and the kind', () => {
		const lines = board_lines()

		expect(line_of(lines, CRITICAL)).toContain(`${String(CRITICAL)} 🚨 🐛 Title`)
		expect(line_of(lines, HIGH)).toContain(`${String(HIGH)} 🔺 🐛 Title`)
		expect(line_of(lines, NORMAL)).toContain(`${String(NORMAL)}    🐛 Title`)
	})

	it('starts every title in one column', () => {
		const lines = board_lines()
		const columns = [CRITICAL, HIGH, NORMAL].map((number) => title_column(lines, number))

		expect(new Set(columns).size).toBe(1)
	})

	it('names the waiting priorities beside the header’s ⏳ count', () => {
		expect(board_lines().join('\n')).toContain('⏳ 3 (🚨 1 🔺 1)')
	})
})
