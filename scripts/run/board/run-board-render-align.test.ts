import type { BudgetWait } from '#scripts/gate/core-wait'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_lead } from './run-board-render-lead'

// joshuafolkken/kit#4292: every lane row — running, held or stopped — draws its progress column, one
// phase icon, its times and its usage cells in the same columns, and a done row reads its state icon,
// its end time and its number in that order.

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, board_usage, header, lines_of } =
	run_board_render_fixture
const { ELAPSED_START, TIME_WIDTH } = run_board_render_lead
const RUNNING = 4001
const HELD = 4002
const STOPPED = 4003
const DONE = 4004
const SPAN = 7

function row(number: number, state: BoardRow['state'], status: BoardRow['status']): BoardRow {
	return {
		number,
		title: `Issue ${String(number)}`,
		kind: undefined,
		state,
		status,
		waits: [],
		reason: undefined,
	}
}

function running(number: number): BoardRow {
	const status = {
		state: 'running' as const,
		started_ms: NOW - 15 * MINUTE,
		track: ['implement' as const],
		phase_ms: NOW - 11 * MINUTE,
	}

	return row(number, 'running', status)
}

function frame(): Array<string> {
	const stopped = { state: 'stopped' as const, started_ms: NOW - SPAN * MINUTE, ended_ms: NOW }
	const merged = { state: 'merged' as const, started_ms: STARTED, ended_ms: NOW - MINUTE }
	const active = [
		running(RUNNING),
		running(HELD),
		row(STOPPED, 'stopped', stopped),
		row(DONE, 'merged', merged),
	]
	const hold: BudgetWait = {
		command: 'lint:related',
		lane: String(HELD),
		elsewhere: undefined,
		waited_ms: 9000,
		reason: 'pressure',
	}

	const usages = board_usage(new Map())
	const layout = { ...EMPTY_LAYOUT, active }

	return lines_of(header({ layout, budget_waits: [hold], usages, spinner: '⠋' }))
}

function line_of(lines: ReadonlyArray<string>, number: number): string {
	return lines.find((line) => line.includes(`Issue ${String(number)}`)) ?? ''
}

// The columns before `marker` on a line, as the terminal counts them.
function column_of(line: string, marker: string): number {
	return run_board_fit.width_of(line.slice(0, line.indexOf(marker)))
}

function count_of(line: string, icon: string): number {
	return line.split(icon).length - 1
}

describe('run_board_render.render lane row alignment', () => {
	const lines = frame()
	const [first = '', held = '', stopped = ''] = [RUNNING, HELD, STOPPED].map((number) =>
		line_of(lines, number),
	)

	it('starts the elapsed and the number columns in one column on a running, a held and a stopped row', () => {
		expect(column_of(first, '15′00″') + '15′00″'.length).toBe(ELAPSED_START + TIME_WIDTH)
		expect(column_of(held, '🧠')).toBe(ELAPSED_START)
		expect(column_of(stopped, '7′00″') + '7′00″'.length).toBe(ELAPSED_START + TIME_WIDTH)
		expect(new Set([first, held, stopped].map((line) => column_of(line, 'Issue')))).toHaveProperty(
			'size',
			1,
		)
	})

	it('draws each lane row’s phase or state icon exactly once', () => {
		expect(count_of(first, '🔨')).toBe(1)
		expect(count_of(held, '🔨')).toBe(1)
		expect(count_of(stopped, '🛑')).toBe(1)
		expect(held).toContain('🚧')
	})

	it('reads a done row as its state icon, its end time and its number, with no finish mark', () => {
		const ended = run_board_labels.day_minute_of(NOW - MINUTE)
		const done = line_of(lines, DONE)

		expect(done).toMatch(new RegExp(`^ {4}✅ ${ended} ${String(DONE)} `, 'u'))
		expect(lines.join('\n')).not.toContain('🔚')
	})
})
