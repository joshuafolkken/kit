import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_earlier } from './run-board-earlier'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_status, type ItemStatus } from './run-board-status'

// joshuafolkken/kit#4260: an earlier run's lane row draws what its lane is doing, and a status its child
// wrote after this run began is never this run's.

const { EMPTY_LAYOUT, GB, NOW, board_usage, header, lines_of } = run_board_render_fixture
const { earlier_of } = run_board_status
const { is_live, own_statuses, rows_of } = run_board_earlier
const EARLIER = 4173
const OWN = 4195
const RELAUNCH_AT = '2026-10-08T08:00:00.000Z'
const LAUNCH = 'child-launch'
const READ = { titles: new Map<number, string>(), labels: new Map() }
const LAUNCHED: ItemStatus = { state: 'running', started_ms: NOW }
const RESUMED: ItemStatus = { state: 'running', started_ms: undefined }

function event_of(pos: number, kind: string, text: string, at = RELAUNCH_AT): RunEvent {
	return { pos, at, kind, text }
}

describe('run_board_earlier.own_statuses', () => {
	it('drops an earlier lane’s status the span holds no launch of', () => {
		const own = own_statuses(new Map([[EARLIER, RESUMED]]), [String(EARLIER)])

		expect(own.has(EARLIER)).toBe(false)
	})

	it('keeps an earlier lane this run launched, and this run’s own child whatever its launch', () => {
		const statuses = new Map([
			[EARLIER, LAUNCHED],
			[OWN, RESUMED],
		])

		expect([...own_statuses(statuses, [String(EARLIER)]).keys()]).toStrictEqual([EARLIER, OWN])
	})
})

describe('run_board_earlier.rows_of', () => {
	it('draws an earlier lane 🧳 with its status, and paused where its lane is paused', () => {
		const lanes = [String(EARLIER), String(OWN)]
		const statuses = new Map<number, ItemStatus>([
			[EARLIER, LAUNCHED],
			[OWN, { state: 'paused' }],
		])
		const rows = rows_of({ lanes, statuses }, new Map(), READ)

		expect(rows.map((row) => [row.state, row.status])).toStrictEqual([
			['earlier', LAUNCHED],
			['paused', { state: 'paused' }],
		])
		expect(rows.every((row) => row.state === 'paused' || is_live(row))).toBe(true)
	})
})

describe('run_board_status.earlier_of', () => {
	it('folds each earlier lane from its newest launch, so its time counts from that launch', () => {
		const events = [
			event_of(1, LAUNCH, `#${String(EARLIER)} a`, '2026-10-08T07:00:00.000Z'),
			event_of(2, 'merge', `#${String(EARLIER)} merged`, '2026-10-08T07:30:00.000Z'),
			event_of(3, LAUNCH, `#${String(EARLIER)} a`),
		]

		expect(earlier_of(events, [String(EARLIER)]).get(EARLIER)).toMatchObject({
			state: 'running',
			started_ms: Date.parse(RELAUNCH_AT),
		})
	})

	it('reads a lane the stream holds no launch of as running with no track', () => {
		const events = [event_of(1, 'resume', `#${String(EARLIER)} resumed`)]

		expect(earlier_of(events, [String(EARLIER)]).get(EARLIER)).toStrictEqual({ state: 'running' })
	})
})

const EARLIER_ROW: BoardRow = {
	number: EARLIER,
	title: 'Earlier',
	kind: undefined,
	state: 'earlier',
	status: { state: 'running', started_ms: NOW, track: ['implement'], phase_ms: NOW },
	waits: [],
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
