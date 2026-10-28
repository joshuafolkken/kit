import { stripVTControlCharacters } from 'node:util'
import { run_event_overrun } from '#scripts/run/event/run-event-overrun'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { Found } from './run-board-found'
import type { BoardRow } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemState } from './run-board-status'

// joshuafolkken/kit#4922: a done row cut its title to keep what was filed during it, so rows whose
// ends differed in length drew their times in different columns. A done row now keeps its title's
// width and cuts the end of its line instead.

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, header } = run_board_render_fixture
const LONG = 4907
const SHORT = 4911
const PLAIN = 4915
const NUMBERS = [LONG, SHORT, PLAIN]
const NARROW = 110
const TIME_END = '″'
const TITLE = 'Push at the first green gate so CI runs beside the review and the lane'

function row_of(number: number, state: ItemState): BoardRow {
	const status = { state, started_ms: STARTED, ended_ms: NOW - MINUTE }

	return { number, title: TITLE, kind: undefined, state, status, waits: [], reason: undefined }
}

function ended(result: string): Found {
	const overrun = { kind: 'ended' as const, issue: LONG, result }

	return {
		filed: [],
		overrun_filed: [],
		minutes: 52,
		overrun,
		longest: undefined,
		is_investigating: false,
	}
}

const UNFILED = ended(run_event_overrun.none_result('waited on a slow CI run'))

function done_lines(columns: number): Array<string> {
	const active = [row_of(LONG, 'merged'), row_of(SHORT, 'merged'), row_of(PLAIN, 'done')]
	const found = new Map([
		[LONG, { ...UNFILED, filed: [4912, 4913, 4914].map(String) }],
		[SHORT, ended(run_event_overrun.FILED_RESULT)],
	])
	const lines = run_board_render
		.render({
			header: header({ layout: { ...EMPTY_LAYOUT, active }, found, is_investigation_on: true }),
			notes: [],
			size: { columns, rows: 60 },
		})
		.map((line) => stripVTControlCharacters(line))

	return NUMBERS.map((number) => lines.find((line) => line.includes(String(number))) ?? '')
}

function time_column(line: string): number {
	return run_board_fit.width_of(line.slice(0, line.indexOf(TIME_END)))
}

describe('run_board_render — a done row on a narrow pane', () => {
	it('draws every row’s time in one column whatever its end', () => {
		const columns = done_lines(NARROW).map((line) => time_column(line))

		expect(new Set(columns).size).toBe(1)
	})

	it('cuts the end of a row too wide for the pane, not its title', () => {
		const [long = '', short = ''] = done_lines(NARROW)
		const title = `${TITLE.slice(0, run_board_render.TITLE_LIMIT - 1)}…`

		expect(run_board_fit.width_of(long)).toBeLessThanOrEqual(NARROW)
		expect(long).toContain(title)
		expect(long).toMatch(/52′ {2}4912, .*…$/u)
		expect(short).toContain(title)
		expect(short).toMatch(/52′ {2}🔍$/u)
	})
})
