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
		phase_ms: NOW - 8 * MINUTE,
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

	return [HELD, PLAIN].map((number) => lines.find((line) => line.includes(String(number))) ?? '')
}

// The columns before `marker` on a line, as the terminal counts them.
function column_of(line: string, marker: string): number {
	return run_board_fit.width_of(line.slice(0, line.indexOf(marker)))
}

describe('run_board_render.render — a running lane row on a narrow pane', () => {
	it('narrows every running row’s title so its whole line stays within the pane', () => {
		const lines = lane_lines(NARROW)

		for (const line of lines) {
			expect(run_board_fit.width_of(line)).toBeLessThanOrEqual(NARROW)
			expect(line).toContain(ELAPSED)
			// The title's cut, then the unmeasured finish (joshuafolkken/kit#7920).
			expect(line).toMatch(/… {2}🎯 —$/u)
		}
	})

	it('cuts a held row and a running row to one title column, their numbers starting in one', () => {
		const [held = '', plain = ''] = lane_lines(NARROW, [wait])

		expect(held).toContain('🚧')
		expect(column_of(held, '…')).toBe(column_of(plain, '…'))
		expect(column_of(held, String(HELD))).toBe(column_of(plain, String(PLAIN)))
		expect(run_board_fit.width_of(held)).toBeLessThanOrEqual(NARROW)
	})

	// joshuafolkken/kit#8990: the title is cut to nothing, then the tail gives up cells or is cut.
	it('keeps a row its title cannot fit on one line, its title cut to nothing', () => {
		const [tight = ''] = lane_lines(TIGHT, [wait])

		expect(run_board_fit.width_of(tight)).toBeLessThanOrEqual(TIGHT)
		expect(tight).not.toContain(`Issue ${String(HELD)}`)
	})

	it('draws a frame with no pane, or a pane wide enough, as it was', () => {
		expect(lane_lines(WIDE)).toStrictEqual(lane_lines(undefined))
	})
})

// joshuafolkken/kit#8257: a queued row with a path after it pads its title to the title column, so a
// narrow pane takes its overrun from that padding before it cuts the title itself.
const QUEUED_NUMBER = 4041
const QUEUED_TITLE = 'A queued row waits'
const PATH = 'package.json'
const SHORTENED = 10

function queued_line(columns: number | undefined): string {
	const reason = { icon: '📂', issues: [String(HELD)], tail: PATH }
	const row: BoardRow = {
		number: QUEUED_NUMBER,
		title: QUEUED_TITLE,
		kind: undefined,
		state: 'waiting',
		status: undefined,
		waits: [],
		reason,
	}
	const layout = { ...EMPTY_LAYOUT, queued: [{ kind: 'row' as const, row }] }
	const size = columns === undefined ? undefined : { columns, rows: 50 }
	const lines = run_board_render
		.render({ header: header({ layout }), notes: [], size })
		.map((line) => stripVTControlCharacters(line))

	return lines.find((line) => line.includes(String(QUEUED_NUMBER))) ?? ''
}

describe('run_board_render.render — a padded queued row on a narrow pane', () => {
	it('gives up its title padding first, keeping its whole title and path within the pane', () => {
		const columns = run_board_fit.width_of(queued_line(undefined)) - SHORTENED
		const line = queued_line(columns)

		expect(run_board_fit.width_of(line)).toBeLessThanOrEqual(columns)
		expect(line).toContain(QUEUED_TITLE)
		expect(line).toContain(PATH)
	})
})
