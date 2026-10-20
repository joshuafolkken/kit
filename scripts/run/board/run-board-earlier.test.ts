import { describe, expect, it } from 'vitest'
import { run_board_earlier } from './run-board-earlier'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#4260, #4269: an earlier run's lane row draws what its lane is doing, marked as an
// earlier run's, and a lane with no lane state record is drawn unknown with the command that writes it.

const { EMPTY_LAYOUT, GB, NOW, board_usage, header, lines_of } = run_board_render_fixture
const { BACKFILL_TAIL, is_live, rows_of } = run_board_earlier
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

	it('draws a lane with no record unknown, saying how to write its record', () => {
		const rows = rows_of({ lanes: [], unknown: [String(UNKNOWN)] }, new Map(), READ)

		expect(rows.map((row) => [row.state, row.reason?.tail, row.is_earlier])).toStrictEqual([
			['unknown', BACKFILL_TAIL, undefined],
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

		expect(lines.find((line) => line.includes('Earlier'))).toMatch(/20\.0 +1\.6 +0\.2 +Earlier/u)
	})
})
