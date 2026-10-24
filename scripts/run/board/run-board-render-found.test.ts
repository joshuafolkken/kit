import { describe, expect, it } from 'vitest'
import type { Found } from './run-board-found'
import type { BoardHeader } from './run-board-header'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#4772: a done row ends on the numbers of the Issues filed during its child, and on
// the spinner — 🔍 where none turns — while its overrun investigation runs.

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, header, lines_of } = run_board_render_fixture
const DONE = 4711
const SPINNER = '⠋'
const STILL = '🔍'
const FILED = ['4768', '4769', '4770']

function row_of(status: ItemStatus): BoardRow {
	return {
		number: DONE,
		title: `Issue ${String(DONE)}`,
		kind: undefined,
		state: status.state,
		status,
		waits: [],
		reason: undefined,
	}
}

const MERGED: ItemStatus = { state: 'merged', started_ms: STARTED, ended_ms: NOW - MINUTE }

function board(
	found: Found | undefined,
	extra: Partial<BoardHeader> = {},
	status: ItemStatus = MERGED,
): BoardHeader {
	return header({
		layout: { ...EMPTY_LAYOUT, active: [row_of(status)] },
		found: new Map(found === undefined ? [] : [[DONE, found]]),
		...extra,
	})
}

function row_line(board_header: BoardHeader): string {
	return lines_of(board_header).find((line) => line.includes(String(DONE))) ?? ''
}

function done_line(found: Found | undefined, extra: Partial<BoardHeader> = {}): string {
	return row_line(board(found, extra))
}

describe('run_board_render — a done row’s filings', () => {
	it('ends on the filed numbers with no `#`', () => {
		const line = done_line({ filed: FILED, is_investigating: false })

		expect(line).toMatch(/4768, 4769, 4770$/u)
		expect(line).not.toContain('#4768')
	})

	it('draws each number through the header’s link', () => {
		const line = done_line(
			{ filed: FILED, is_investigating: false },
			{ link: (reference) => `<${reference}>` },
		)

		expect(line).toMatch(/<4768>, <4769>, <4770>$/u)
	})

	it('draws them on a 🏁 done row too', () => {
		const status: ItemStatus = { ...MERGED, state: 'done' }
		const line = row_line(board({ filed: FILED, is_investigating: false }, {}, status))

		expect(line).toMatch(/4768, 4769, 4770$/u)
	})

	it('draws none on a row still running', () => {
		const status: ItemStatus = { state: 'running', started_ms: STARTED }
		const line = row_line(board({ filed: FILED, is_investigating: true }, {}, status))

		expect(line).not.toContain('4768')
		expect(line).not.toContain(STILL)
	})

	it('draws a row with nothing filed and no investigation as before', () => {
		expect(done_line({ filed: [], is_investigating: false })).toBe(done_line(undefined))
		expect(done_line(undefined)).toMatch(/Issue 4711\s+\S+$/u)
	})
})

describe('run_board_render — a done row’s running investigation', () => {
	it('ends on the spinner after the numbers where one turns', () => {
		const line = done_line({ filed: FILED, is_investigating: true }, { spinner: SPINNER })

		expect(line).toMatch(new RegExp(`4770 ${SPINNER}$`, 'u'))
	})

	it('ends on 🔍 where no spinner turns, and the legend names it', () => {
		const lines = lines_of(board({ filed: [], is_investigating: true }))

		expect(lines.find((line) => line.includes(String(DONE)))).toMatch(new RegExp(`${STILL}$`, 'u'))
		expect(lines.join('\n')).toContain(`${STILL} overrun investigation`)
	})

	it('draws neither once the investigation is over', () => {
		const line = done_line({ filed: FILED, is_investigating: false }, { spinner: SPINNER })

		expect(line).not.toContain(SPINNER)
		expect(line).not.toContain(STILL)
	})
})
