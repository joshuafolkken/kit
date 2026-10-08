import { backlog_idle } from '#scripts/backlog/backlog-idle'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_notes } from './run-board-notes'
import { run_board_status } from './run-board-status'

// joshuafolkken/kit#3430: what each child of a run is doing, and the run's own activity, read off the
// event stream and the open lanes — no GitHub read.

const KIND = run_event_stream.EVENT_KIND
const T0 = '2026-10-08T09:00:00.000Z'
const T1 = '2026-10-08T09:05:00.000Z'
const T2 = '2026-10-08T09:10:00.000Z'
const T3 = '2026-10-08T09:15:00.000Z'
const LAUNCH_3409 = '#3409 launched'
const MERGE_3409 = '#3409 merged'
const PR_3415 = '#3415 PR #3500'
const DECISION_PARK = '#3433 parked (needs-decision)'

function event_at(pos: number, at: string, kind: string, text: string): RunEvent {
	return { pos, at, kind, text }
}

const IDLE_TEXT = backlog_idle.text_of({
	since_ms: Date.parse(T2),
	until_ms: Date.parse(T3),
	bound: 'idle',
	asked_ms: Date.parse(T2),
})

describe('run_board_status.statuses_of', () => {
	it('follows each child from launch to merge or park, keeping when it started', () => {
		const events = [
			event_at(1, T0, KIND.CHILD_LAUNCH, LAUNCH_3409),
			event_at(2, T0, KIND.CHILD_LAUNCH, '#3415 launched'),
			event_at(3, T1, KIND.PR_OPENED, PR_3415),
			event_at(4, T2, KIND.MERGE, MERGE_3409),
			event_at(5, T3, KIND.PARK, DECISION_PARK),
		]
		const statuses = run_board_status.statuses_of(events, [])

		expect(statuses.get(3409)).toStrictEqual({
			state: 'merged',
			started_ms: Date.parse(T0),
			ended_ms: Date.parse(T2),
		})
		expect(statuses.get(3415)).toMatchObject({ state: 'running', phase: KIND.PR_OPENED })
		expect(statuses.get(3433)?.state).toBe('parked')
	})

	it('reads an open lane the stream never saw launched as running, with its lane', () => {
		const statuses = run_board_status.statuses_of([], ['3420'])

		expect(statuses.get(3420)).toStrictEqual({ state: 'running', lane: 'lane 3420' })
	})

	it('leaves a settled child settled even while its lane is still open', () => {
		const events = [event_at(1, T0, KIND.MERGE, MERGE_3409)]

		expect(run_board_status.statuses_of(events, ['3409']).get(3409)?.state).toBe('merged')
	})
})

describe('run_board_status.activity_of', () => {
	it('reads the newest idle window opened after the newest launch', () => {
		const events = [
			event_at(1, T0, KIND.CHILD_LAUNCH, LAUNCH_3409),
			event_at(2, T2, KIND.IDLE, IDLE_TEXT),
		]

		expect(run_board_status.activity_of(events)).toStrictEqual({
			last_event_ms: Date.parse(T2),
			idle: backlog_idle.parse(IDLE_TEXT),
			is_stopped: false,
		})
	})

	it('drops an idle window a later launch ended', () => {
		const events = [
			event_at(1, T2, KIND.IDLE, IDLE_TEXT),
			event_at(2, T3, KIND.CHILD_LAUNCH, '#3438 launched'),
		]

		expect(run_board_status.activity_of(events).idle).toBeUndefined()
	})

	it('reads a stop naming no child as the run itself ending, past trailing trace events', () => {
		const events = [
			event_at(1, T0, KIND.STOP, 'backlog drained'),
			event_at(2, T1, KIND.HEARTBEAT, 'still here'),
		]

		expect(run_board_status.activity_of(events).is_stopped).toBe(true)
		expect(run_board_status.activity_of([]).last_event_ms).toBeUndefined()
	})
})

describe('run_board_notes.notes_of', () => {
	it('lists filings, parks and notes newest first, telling a needs-decision park apart', () => {
		const events = [
			event_at(1, T0, KIND.FILED, '#3438 Count the seats again (found during #3415)'),
			event_at(2, T1, KIND.PARK, DECISION_PARK),
			event_at(3, T2, KIND.NOTE, '#3415 gate took 40% longer'),
			event_at(4, T3, KIND.PARK, '#3409 parked'),
			event_at(5, T3, KIND.MERGE, '#3420 merged'),
		]
		const notes = run_board_notes.notes_of(events)

		expect(notes.map((note) => [note.kind, note.issue, note.is_decision])).toStrictEqual([
			['park', '3409', false],
			['note', '3415', false],
			['park', '3433', true],
			['filed', '3438', false],
		])
		expect(notes.at(-1)).toMatchObject({ text: 'Count the seats again', found_during: '3415' })
	})

	it('keeps an Issue filed elsewhere qualified', () => {
		const [note] = run_board_notes.notes_of([
			event_at(1, T0, KIND.FILED, 'joshuafolkken/app-kit#12 Fix the port'),
		])

		expect(note?.issue).toBe('joshuafolkken/app-kit#12')
	})
})
