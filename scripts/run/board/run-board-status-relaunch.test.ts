import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import type { ClosedIssue } from './run-board-closed'
import { run_board_status, type ItemStatus, type OpenRead } from './run-board-status'

// joshuafolkken/kit#3971: a child launched again in the same run — a re-dispatch after an outage, or a
// person's restart — keeps the row's time counting from its first launch, while its track and the
// time of its phase start over.

const KIND = run_event_stream.EVENT_KIND
const ISSUE = 3964
const T0 = '2026-10-16T13:35:30.000Z'
const T1 = '2026-10-16T13:50:00.000Z'
const T2 = '2026-10-16T13:56:31.000Z'
const T3 = '2026-10-16T13:56:45.000Z'
const NONE: ReadonlySet<number> = new Set()
const NOT_READ: ReadonlyMap<number, ClosedIssue> = new Map()
const NO_LABELS: ReadonlyMap<number, ReadonlyArray<string>> = new Map()

// An open listing holding the child, read after its first launch and before its relaunch.
function read_between(
	closed: ReadonlyMap<number, ClosedIssue>,
	labels: ReadonlyMap<number, ReadonlyArray<string>>,
): OpenRead {
	return { open_numbers: new Set([ISSUE]), read_ms: Date.parse(T2), closed, labels }
}

function status_after(...events: ReadonlyArray<[string, string, string]>): ItemStatus | undefined {
	const stream: Array<RunEvent> = events.map(([at, kind, text], index) => ({
		pos: index + 1,
		at,
		kind,
		text,
	}))

	return run_board_status.statuses_of(stream, [], NONE).get(ISSUE)
}

// Launched, moved on to implement, stopped on an outage, and launched again by `kind`.
function relaunched_by(kind: string, text: string): ItemStatus | undefined {
	return status_after(
		[T0, KIND.CHILD_LAUNCH, `#${String(ISSUE)} dispatched`],
		[T1, KIND.LANE_PHASE, `#${String(ISSUE)} implement`],
		[T2, KIND.SHIP_STOP, `#${String(ISSUE)} review failed`],
		[T3, kind, text],
	)
}

describe('run_board_status.statuses_of relaunch', () => {
	it.each<[string, string, string]>([
		['a re-dispatch after an outage', KIND.CHILD_LAUNCH, `#${String(ISSUE)} dispatched`],
		['a person’s restart', KIND.RESTART, `#${String(ISSUE)} restarted in a fresh session`],
	])('keeps the first launch as the start across %s', (_label, kind, text) => {
		expect(relaunched_by(kind, text)).toStrictEqual({
			state: 'running',
			started_ms: Date.parse(T0),
			launched_ms: Date.parse(T3),
			track: ['investigate'],
			phase_ms: Date.parse(T3),
		})
	})

	it('keeps the newest launch once the relaunched child settles', () => {
		const settled = status_after(
			[T0, KIND.CHILD_LAUNCH, `#${String(ISSUE)} dispatched`],
			[T2, KIND.CHILD_LAUNCH, `#${String(ISSUE)} dispatched`],
			[T3, KIND.MERGE, `#${String(ISSUE)} merged`],
		)

		expect(settled).toMatchObject({ started_ms: Date.parse(T0), launched_ms: Date.parse(T2) })
	})

	it('keeps the newest launch across a cut and its resume', () => {
		const resumed = status_after(
			[T0, KIND.CHILD_LAUNCH, `#${String(ISSUE)} dispatched`],
			[T1, KIND.CHILD_LAUNCH, `#${String(ISSUE)} dispatched`],
			[T2, KIND.CUT, `#${String(ISSUE)} cut`],
			[T3, KIND.RESUME, `#${String(ISSUE)}`],
		)

		expect(resumed).toMatchObject({ started_ms: Date.parse(T0), launched_ms: Date.parse(T1) })
	})
})

describe('run_board_status.settle_closed after a relaunch', () => {
	const relaunched = relaunched_by(KIND.CHILD_LAUNCH, `#${String(ISSUE)} dispatched`)
	const statuses = new Map(relaunched === undefined ? [] : [[ISSUE, relaunched]])

	it('ignores labels read between the first launch and the relaunch', () => {
		const read = read_between(NOT_READ, new Map([[ISSUE, ['bug']]]))

		expect(run_board_status.settle_closed(statuses, read).get(ISSUE)?.state).toBe('running')
	})

	it('ignores a close dated before the relaunch', () => {
		const closed: ClosedIssue = {
			title: '',
			labels: [],
			closed_ms: Date.parse(T2),
			is_merged: false,
			is_not_planned: false,
		}
		const read = read_between(new Map([[ISSUE, closed]]), NO_LABELS)

		expect(run_board_status.settle_closed(statuses, read).get(ISSUE)?.state).toBe('running')
	})
})
