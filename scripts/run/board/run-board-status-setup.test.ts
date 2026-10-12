import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_status } from './run-board-status'

// joshuafolkken/kit#3696: a lane the run is still setting up for is not its child yet, so its row
// waits rather than reading as a child that stopped; and the run's activity carries the stage.

const KIND = run_event_stream.EVENT_KIND
const AT = '2026-10-12T09:00:00.000Z'
const { STAGE } = run_event_setup
const IN_RUN: ReadonlySet<number> = new Set([278, 279])
const LANES = ['278']
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
			is_preparing: true,
			last_event_ms: Date.parse(AT),
			is_stopped: false,
		})
	})

	it('carries no stage once a child has launched', () => {
		const activity = run_board_status.activity_of(stream(setup(STAGE.HANDING_OFF), LAUNCH_278))

		expect(activity).toMatchObject({ setup: undefined, is_preparing: false })
	})
})
