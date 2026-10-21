import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_status } from './run-board-status'

// joshuafolkken/kit#3696: the run's activity carries the setup stage. A lane the run is still setting
// up for draws no row of its own — its record is `open` (`run-board-lane-state.test.ts`).

const KIND = run_event_stream.EVENT_KIND
const AT = '2026-10-12T09:00:00.000Z'
const SESSION_AT = '2026-10-12T09:02:00.000Z'
const HANDED_AT = '2026-10-12T09:22:00.000Z'
const BEAT_AT = '2026-10-12T09:23:00.000Z'
const { STAGE } = run_event_setup
const MERGED_278 = '#278 merged'
const LAUNCHED_278 = '#278 launched'
const LAUNCH_278: Step = [KIND.CHILD_LAUNCH, LAUNCHED_278]

// One event, as its kind and text.
type Step = [string, string]

function setup(text: string): Step {
	return [KIND.SETUP, text]
}

function stream(...steps: ReadonlyArray<Step>): Array<RunEvent> {
	return steps.map(([kind, text], index) => ({ pos: index + 1, at: AT, kind, text }))
}

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
			lane_events: new Map(),
			pr_checks: new Map(),
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
		const events: Array<RunEvent> = [
			{ pos: 1, at: AT, kind: KIND.SETUP, text: STAGE.HANDING_OFF },
			{ pos: 2, at: SESSION_AT, kind: KIND.CHILD_LAUNCH, text: LAUNCHED_278 },
			{ pos: 3, at: HANDED_AT, kind: KIND.MERGE, text: MERGED_278 },
			{ pos: 4, at: BEAT_AT, kind: KIND.HEARTBEAT, text: 'at #278' },
		]

		expect(run_board_status.activity_of(events).idle_ms).toBe(Date.parse(HANDED_AT))
	})
})
