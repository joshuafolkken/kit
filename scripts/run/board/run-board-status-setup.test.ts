import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_status } from './run-board-status'

// joshuafolkken/kit#3696: a lane the run is still setting up for is not its child yet, so its row
// waits rather than reading as a child that stopped; and the run's activity carries the stage.

const KIND = run_event_stream.EVENT_KIND
const AT = '2026-10-12T09:00:00.000Z'
const SESSION_AT = '2026-10-12T09:02:00.000Z'
const HANDED_AT = '2026-10-12T09:22:00.000Z'
const BEAT_AT = '2026-10-12T09:23:00.000Z'
const { STAGE } = run_event_setup
const IN_RUN: ReadonlySet<number> = new Set([278, 279])
const LANES = ['278']
const MERGED_278 = '#278 merged'
const LAUNCH_278: Step = [KIND.CHILD_LAUNCH, '#278 launched']

// One event, as its kind and text.
type Step = [string, string]

function setup(text: string): Step {
	return [KIND.SETUP, text]
}

function stream(...steps: ReadonlyArray<Step>): Array<RunEvent> {
	return steps.map(([kind, text], index) => ({ pos: index + 1, at: AT, kind, text }))
}

describe('run_board_status.statuses_of during setup', () => {
	it('leaves a lane with no launch out of the running children while the run sets up', () => {
		const events = stream(setup(STAGE.HANDING_OFF), setup(run_event_setup.opening_lane('278')))

		expect(run_board_status.statuses_of(events, LANES, IN_RUN).has(278)).toBe(false)
	})

	it('draws the lane running from its launch', () => {
		const events = stream(setup(run_event_setup.opening_lane('278')), LAUNCH_278)

		expect(run_board_status.statuses_of(events, LANES, IN_RUN).get(278)).toMatchObject({
			state: 'running',
			lane: 'lane 278',
		})
	})

	it('holds back only the lane being opened once the run has a child', () => {
		const events = stream(LAUNCH_278, setup(run_event_setup.opening_lane('279')))
		const statuses = run_board_status.statuses_of(events, ['278', '279'], IN_RUN)

		expect(statuses.get(278)?.state).toBe('running')
		expect(statuses.has(279)).toBe(false)
	})

	it('still reads a restored run’s lane as running where the stream carries no stage', () => {
		const statuses = run_board_status.statuses_of([], LANES, IN_RUN)

		expect(statuses.get(278)).toStrictEqual({ state: 'running', lane: 'lane 278' })
	})
})

describe('run_board_status.activity_of during setup', () => {
	it('carries the stage and its event’s time, so the heartbeat counts from it', () => {
		const activity = run_board_status.activity_of(stream(setup(STAGE.STARTING)))

		expect(activity).toStrictEqual({
			setup: STAGE.STARTING,
			setup_ms: Date.parse(AT),
			last_event_ms: Date.parse(AT),
			latest: { text: STAGE.STARTING, at_ms: Date.parse(AT) },
			idle_ms: Date.parse(AT),
			is_stopped: false,
		})
	})

	it('carries no stage once a child has launched', () => {
		const activity = run_board_status.activity_of(stream(setup(STAGE.HANDING_OFF), LAUNCH_278))

		expect(activity).toMatchObject({ setup: undefined, setup_ms: undefined })
	})

	// joshuafolkken/kit#3749: the newest thing the run did is its newest position, not a trace after it.
	it('carries the newest position as the latest event, past a stage written after it', () => {
		const events = stream(LAUNCH_278, [KIND.MERGE, MERGED_278], setup(STAGE.HANDING_OFF))

		expect(run_board_status.activity_of(events).latest?.text).toBe(MERGED_278)
	})

	it('carries no latest event off an empty stream', () => {
		expect(run_board_status.activity_of([]).latest).toBeUndefined()
	})
})

// joshuafolkken/kit#3749: how long the run has watched is counted from the newest thing it did itself.
describe('run_board_status.activity_of idle time', () => {
	it('carries no idle time off an empty stream', () => {
		expect(run_board_status.activity_of([]).idle_ms).toBeUndefined()
	})

	// A judgment session's minutes are the run's own: the watch after it starts at the hand-off that
	// ended it, not at the merge before it.
	it('counts the idle time from a stage written after the newest position', () => {
		const events: Array<RunEvent> = [
			{ pos: 1, at: AT, kind: KIND.MERGE, text: MERGED_278 },
			{ pos: 2, at: SESSION_AT, kind: KIND.SETUP, text: STAGE.SESSION },
			{ pos: 3, at: HANDED_AT, kind: KIND.SETUP, text: STAGE.HANDING_OFF },
			{ pos: 4, at: BEAT_AT, kind: KIND.HEARTBEAT, text: 'at #278' },
		]
		const activity = run_board_status.activity_of(events)

		expect(activity.idle_ms).toBe(Date.parse(HANDED_AT))
		expect(activity.latest?.at_ms).toBe(Date.parse(AT))
	})

	it('counts the idle time from a position newer than every stage', () => {
		const events = stream(setup(STAGE.HANDING_OFF), LAUNCH_278, [KIND.MERGE, MERGED_278])

		expect(run_board_status.activity_of(events).idle_ms).toBe(Date.parse(AT))
	})
})
