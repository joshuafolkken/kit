import { stripVTControlCharacters } from 'node:util'
import type { BudgetWait } from '#scripts/gate/core-wait'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardHeader } from './run-board-header'
import type { BoardRow } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#4226: a running lane row wrapped its tail on a narrow pane, where only a row with a
// reason or a held check kept its line. Every lane row that draws a tail now keeps it, all of them
// cutting their titles by the columns the widest runs over, so their titles and times end in one column.

const { EMPTY_LAYOUT, MINUTE, NOW, header } = run_board_render_fixture
const HELD = 4039
const PLAIN = 4040
const NARROW = 70
const TIGHT = 40
const WIDE = 300
const ELAPSED = '15′00″'

function running(number: number): BoardRow {
	const status = {
		state: 'running' as const,
		started_ms: NOW - 15 * MINUTE,
		track: ['implement' as const],
		phase_ms: NOW - 11 * MINUTE,
	}
	const title = `Issue ${String(number)} narrows a long title down to fit the pane`

	return { number, title, kind: undefined, state: 'running', status, waits: [] }
}

const wait: BudgetWait = {
	command: 'lint:related',
	lane: String(HELD),
	elsewhere: undefined,
	waited_ms: 9000,
	reason: 'pressure',
}

function board(waits: ReadonlyArray<BudgetWait>): BoardHeader {
	const active = [running(HELD), running(PLAIN)]

	return header({ layout: { ...EMPTY_LAYOUT, active }, budget_waits: waits })
}

function lane_lines(
	columns: number | undefined,
	waits: ReadonlyArray<BudgetWait> = [],
): Array<string> {
	const size = columns === undefined ? undefined : { columns, rows: 50 }
	const lines = run_board_render
		.render({ header: board(waits), notes: [], size })
		.map((line) => stripVTControlCharacters(line))

	return [HELD, PLAIN].map(
		(number) => lines.find((line) => line.includes(String(number)) && line.includes(ELAPSED)) ?? '',
	)
}

// The columns before `marker` on a line, as the terminal counts them.
function column_of(line: string, marker: string): number {
	return run_board_fit.width_of(line.slice(0, line.indexOf(marker)))
}

// A line from its elapsed time on: what a row keeps whole however narrow its pane.
function tail_of(line: string): string {
	return line.slice(line.indexOf(ELAPSED))
}

describe('run_board_render.render — a running lane row on a narrow pane', () => {
	it('narrows every running row’s title so its whole line stays within the pane', () => {
		const lines = lane_lines(NARROW)

		for (const line of lines) {
			expect(run_board_fit.width_of(line)).toBeLessThanOrEqual(NARROW)
			expect(line).toMatch(/…\s+15′00″/u)
		}
	})

	it('cuts a held row and a running row to one title column, their times ending in one', () => {
		const [held = '', plain = ''] = lane_lines(NARROW, [wait])
		const ends = [held, plain].map((line) => column_of(line, ELAPSED) + ELAPSED.length)

		expect(held).toContain('🚧')
		expect(column_of(held, '…')).toBe(column_of(plain, '…'))
		expect(ends[0]).toBe(ends[1])
		expect(run_board_fit.width_of(held)).toBeLessThanOrEqual(NARROW)
	})

	it('wraps a row its floor cannot fit, keeping its whole tail', () => {
		const [tight = ''] = lane_lines(TIGHT, [wait])
		const [wide = ''] = lane_lines(WIDE, [wait])

		expect(run_board_fit.width_of(tight)).toBeGreaterThan(TIGHT)
		expect(tail_of(tight)).toBe(tail_of(wide))
	})

	it('draws a frame with no pane, or a pane wide enough, as it was', () => {
		expect(lane_lines(WIDE)).toStrictEqual(lane_lines(undefined))
	})
})
