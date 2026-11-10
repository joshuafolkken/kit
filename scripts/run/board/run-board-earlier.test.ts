import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_earlier } from './run-board-earlier'
import { run_board_fit } from './run-board-fit'
import type { BoardRow } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#4260, #4269: an earlier run's lane row draws what its lane is doing, marked as an
// earlier run's, and a lane with no lane state record is drawn unknown with the command that writes it.

const { EMPTY_LAYOUT, GB, NOW, board_usage, header, lines_of } = run_board_render_fixture
const { UNKNOWN_TAIL, earlier_marked, is_live, rows_of } = run_board_earlier
const { width_of } = run_board_fit
const { render } = run_board_render
const EARLIER = 4173
const PAUSED = 4180
const UNKNOWN = 4190
const OWN = 4195
const READ = { titles: new Map<number, string>(), labels: new Map() }
const LAUNCHED: ItemStatus = { state: 'running', started_ms: NOW }
const FROZEN: ItemStatus = { state: 'paused', started_ms: NOW, ended_ms: NOW }

describe('run_board_earlier.rows_of', () => {
	it('draws an earlier lane with its own state, marked as an earlier run’s', () => {
		const lanes = [String(EARLIER), String(PAUSED)]
		const statuses = new Map([
			[EARLIER, LAUNCHED],
			[PAUSED, FROZEN],
		])
		const rows = rows_of({ lanes, statuses }, new Map(), READ)

		expect(rows.map((row) => [row.state, row.status, row.is_earlier])).toStrictEqual([
			['running', LAUNCHED, true],
			['paused', FROZEN, true],
		])
		expect(rows.map((row) => is_live(row))).toStrictEqual([true, false])
	})

	it('draws a lane with no record unknown, saying it keeps its place', () => {
		const rows = rows_of({ lanes: [], unknown: [String(UNKNOWN)] }, new Map(), READ)

		expect(rows.map((row) => [row.state, row.reason?.tail, row.is_earlier])).toStrictEqual([
			['unknown', UNKNOWN_TAIL, undefined],
		])
	})

	it('leaves out a lane whose issue this run has a status for', () => {
		const rows = rows_of(
			{ lanes: [String(OWN)], unknown: [String(OWN)] },
			new Map([[OWN, LAUNCHED]]),
			READ,
		)

		expect(rows).toStrictEqual([])
	})
})

// joshuafolkken/kit#4383: an earlier run's lane draws its priority as this run's rows do.
describe('run_board_earlier.rows_of — the priority', () => {
	it('reads the priority from the lane issue’s labels', () => {
		const labels = new Map([
			[EARLIER, ['priority:critical']],
			[UNKNOWN, ['priority:high']],
		])
		const read = { ...READ, labels }
		const earlier = { lanes: [String(EARLIER)], statuses: new Map([[EARLIER, LAUNCHED]]) }
		const rows = rows_of({ ...earlier, unknown: [String(UNKNOWN)] }, new Map(), read)

		expect(rows.map((row) => row.priority)).toStrictEqual(['critical', 'high'])
	})
})

const EARLIER_ROW: BoardRow = {
	number: EARLIER,
	title: 'Earlier',
	kind: undefined,
	state: 'running',
	status: { state: 'running', started_ms: NOW, track: ['implement'], phase_ms: NOW },
	waits: [],
	is_earlier: true,
}

describe('run_board_render.render an earlier run’s lane row', () => {
	it('draws its CPU, MEM and CMPRS as a running row’s', () => {
		const usages = board_usage(
			new Map([[EARLIER, { cpu_cores: 2, memory_bytes: 1.6 * GB, compressed_bytes: 0.2 * GB }]]),
		)
		const lines = lines_of(header({ layout: { ...EMPTY_LAYOUT, earlier: [EARLIER_ROW] }, usages }))

		expect(lines.find((line) => line.includes('Earlier'))).toMatch(
			/20\.0 +1\.6 +0\.2 4173 +Earlier/u,
		)
	})
})

// joshuafolkken/kit#7098: 🧳 follows the title, where the phase's icon was hidden behind it.
describe('run_board_earlier.earlier_marked', () => {
	const OVER = 'over budget +3′'

	it.each([
		[
			['🚦 0″', OVER],
			['🧳 🚦 0″', OVER],
		],
		[[''], ['🧳']],
		[[], ['🧳']],
	])('leads an earlier run’s tail %j with 🧳', (tail, marked) => {
		expect(earlier_marked(EARLIER_ROW, tail)).toStrictEqual(marked)
	})

	it('leaves this run’s own row’s tail as it is', () => {
		expect(earlier_marked({ ...EARLIER_ROW, is_earlier: undefined }, ['lint'])).toStrictEqual([
			'lint',
		])
	})
})

function line_of(lines: ReadonlyArray<string>, issue: number): string {
	return lines.find((line) => line.includes(` ${String(issue)} `)) ?? ''
}

// The terminal column a row's cut title ends in.
function cut_end(line: string): number {
	return width_of(line.slice(0, line.indexOf('…')))
}

describe('run_board_render.render an earlier run’s lane row on a narrow pane', () => {
	const LONG = 'A title long enough to be cut on a narrow pane, and then some more'
	const NARROW = 90
	// Narrow enough that the pane, not the title's own limit, cuts the title.
	const NARROWER = 60
	const own: BoardRow = { ...EARLIER_ROW, number: OWN, title: LONG, is_earlier: undefined }
	const earlier: BoardRow = { ...EARLIER_ROW, title: LONG }

	const ROWS = 60

	it('cuts its title to end in the column this run’s own row’s does, keeping 🧳', () => {
		const board = header({ layout: { ...EMPTY_LAYOUT, active: [own], earlier: [earlier] } })
		const drawn = render({ header: board, notes: [], size: { columns: NARROW, rows: ROWS } })
		const lines = drawn.map((line) => stripVTControlCharacters(line))
		const earlier_line = line_of(lines, EARLIER)

		expect(earlier_line.trimEnd()).toMatch(/… {2}🧳$/u)
		expect(cut_end(earlier_line)).toBe(cut_end(line_of(lines, OWN)))
	})

	// A paused row draws no tail of its own; its 🧳 alone still keeps its line whole and its title
	// ending where its section's running row's does.
	it('keeps 🧳 on a paused earlier row, its title ending with the running row’s', () => {
		const paused: BoardRow = { ...earlier, number: PAUSED, state: 'paused', status: FROZEN }
		const board = header({ layout: { ...EMPTY_LAYOUT, earlier: [earlier, paused] } })
		const drawn = render({ header: board, notes: [], size: { columns: NARROWER, rows: ROWS } })
		const lines = drawn.map((line) => stripVTControlCharacters(line))
		const paused_line = line_of(lines, PAUSED)

		expect(paused_line.trimEnd()).toMatch(/… {2}🧳$/u)
		expect(cut_end(paused_line)).toBe(cut_end(line_of(lines, EARLIER)))
	})
})
