import type { IdleWindow } from '#scripts/backlog/backlog-idle'
import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout, BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#3687: the wait is two parts of the header's second line — the minute the run's
// hands became free and how long the wait has left — and never a third line, so the table under the
// header does not move when a wait begins. What these cases pin is the header in each of the four
// states a run can be in: waiting, running, waiting on a person, and ended.

const { minute_of } = run_board_labels
const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, header, lines_of } = run_board_render_fixture
const SECOND = 1000
const HOUR = 60 * MINUTE
const MACHINE_UNKNOWN = '⚡ -  🧠 -  💾 -'
const EMPTY_BAR = '─'.repeat(10)
const COUNTS = `✅ 0/0 ${EMPTY_BAR}  🔄 0  ⏳ 0  💤 0`
// The run's hands became free ten minutes ago, and the wait that began then has 7:42:18 left.
const SINCE = NOW - 10 * MINUTE
const LEFT = 7 * HOUR + 42 * MINUTE + 18 * SECOND
const IDLE: IdleWindow = { since_ms: SINCE, until_ms: NOW + LEFT, asked_ms: NOW - 3 * MINUTE }
const WAIT_PARTS = `⏸ ${minute_of(SINCE)}  ⌛ 7:42:18`
const WAITING = { last_event_ms: NOW - MINUTE, idle: IDLE, is_stopped: false }

function row(number: number, state: BoardRow['state']): BoardRow {
	return { number, title: undefined, kind: undefined, state, status: undefined, waits: [] }
}

const RUNNING_LAYOUT: BoardLayout = { ...EMPTY_LAYOUT, active: [row(1, 'running')] }
const PEOPLE_LAYOUT: BoardLayout = { ...EMPTY_LAYOUT, people: [row(2, 'human')] }

describe('run_board_render.render — the header while the run waits', () => {
	it('draws when the wait began and how long it has left on the second line', () => {
		expect(lines_of(header({ activity: WAITING })).slice(0, 2)).toStrictEqual([
			`⏸ backlogrun  ${COUNTS}  💓 01:00`,
			`⏱ 2:10:00  ${WAIT_PARTS}  ${MACHINE_UNKNOWN}`,
		])
	})

	it('draws no third line for the wait, so what follows the header does not move', () => {
		const waiting = lines_of(header({ activity: WAITING }))
		const quiet = lines_of(header())

		expect(waiting).toHaveLength(quiet.length)
		expect(waiting.slice(2)).toStrictEqual(quiet.slice(2))
	})

	it('marks a run waiting on a person ✋ and changes nothing else', () => {
		const lines = lines_of(header({ activity: WAITING, layout: PEOPLE_LAYOUT }))

		expect(lines[0]).toMatch(/^✋ backlogrun {2}✅ 0\/1 /u)
		expect(lines[1]).toBe(`⏱ 2:10:00  ${WAIT_PARTS}  ${MACHINE_UNKNOWN}`)
	})
})

describe('run_board_render.render — the header while the run is not waiting', () => {
	it('draws neither wait part while a child runs, though the stream says the run waits', () => {
		const lines = lines_of(header({ activity: WAITING, layout: RUNNING_LAYOUT }))

		expect(lines[0]).toMatch(/^▶ backlogrun/u)
		expect(lines[1]).toBe(`⏱ 2:10:00  ${MACHINE_UNKNOWN}`)
	})

	it('draws an ended run’s length and the minute it ended, and no wait', () => {
		const ended_ms = STARTED + 3 * MINUTE + 25 * SECOND
		const activity = { last_event_ms: ended_ms, idle: IDLE, is_stopped: true }
		const lines = lines_of(header({ activity, ended_ms }))

		expect(lines.slice(0, 2)).toStrictEqual([
			`■ backlogrun  ${COUNTS}`,
			`⏱ 0:03:25  🔚 ${minute_of(ended_ms)}  ${MACHINE_UNKNOWN}`,
		])
	})
})
