import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_setup } from './run-board-setup'

// joshuafolkken/kit#3696: what `run:board` reads off a run's `setup` events — the stage it draws until
// the first child launches, when the run is preparing a launch, and which lanes are not children yet.

const KIND = run_event_stream.EVENT_KIND
const AT = '2026-10-12T09:00:00.000Z'
const { STAGE } = run_event_setup
const OPENING_278 = run_event_setup.opening_lane('278')
const OPENING_279 = run_event_setup.opening_lane('279')
const LAUNCH_278: Step = [KIND.CHILD_LAUNCH, '#278 launched']
const MERGE_278: Step = [KIND.MERGE, '#278 merged']
const IDLE = { setup: undefined, is_preparing: false }

// One event, as its kind and text.
type Step = [string, string]

function setup(text: string): Step {
	return [KIND.SETUP, text]
}

function stream(...steps: ReadonlyArray<Step>): Array<RunEvent> {
	return steps.map(([kind, text], index) => ({ pos: index + 1, at: AT, kind, text }))
}

describe('run_board_setup.read before the first launch', () => {
	it('reads no stage off a stream that carries none', () => {
		expect(run_board_setup.read([])).toStrictEqual(IDLE)
		expect(run_board_setup.read(stream(MERGE_278))).toStrictEqual(IDLE)
	})

	it('reads the newest stage, in its own words, as a run preparing', () => {
		const events = stream(setup(STAGE.STARTING), setup(STAGE.PLANNING), setup(STAGE.HANDING_OFF))

		expect(run_board_setup.read(events)).toStrictEqual({
			setup: STAGE.HANDING_OFF,
			is_preparing: true,
		})
	})

	// joshuafolkken/kit#3731: the hand-back replaces the hand-off it follows, and the next one replaces it.
	it('reads a run handed to a session as waiting on judgment until the next hand-off', () => {
		const handed_back = stream(setup(STAGE.HANDING_OFF), setup(STAGE.JUDGING))
		const resumed = stream(setup(STAGE.HANDING_OFF), setup(STAGE.JUDGING), setup(STAGE.HANDING_OFF))

		expect(run_board_setup.read(handed_back).setup).toBe(STAGE.JUDGING)
		expect(run_board_setup.read(resumed).setup).toBe(STAGE.HANDING_OFF)
	})

	it('keeps the stage past a position that is not a launch', () => {
		const events = stream(setup(STAGE.PLANNING), [KIND.PLAN, 'planned #278'])

		expect(run_board_setup.read(events).setup).toBe(STAGE.PLANNING)
	})
})

describe('run_board_setup.read after a drain that came before any launch', () => {
	const DRAIN: Step = [KIND.DRAIN, 'backlog drained']

	it('reads the hand-off each wake of the idle watch writes as no stage and no preparing', () => {
		const events = stream(setup(STAGE.HANDING_OFF), DRAIN, setup(STAGE.HANDING_OFF))

		expect(run_board_setup.read(events)).toStrictEqual(IDLE)
	})

	it('is preparing again once a lane opens for an issue the watch picked up', () => {
		const events = stream(setup(STAGE.HANDING_OFF), DRAIN, setup(OPENING_278))

		expect(run_board_setup.read(events)).toStrictEqual({ setup: undefined, is_preparing: true })
	})
})

describe('run_board_setup.read after the first launch', () => {
	it('draws no stage once a child has launched', () => {
		const events = stream(setup(OPENING_278), LAUNCH_278)

		expect(run_board_setup.read(events)).toStrictEqual(IDLE)
	})

	it('is preparing again while a lane opens for the next child', () => {
		const events = stream(setup(OPENING_278), LAUNCH_278, MERGE_278, setup(OPENING_279))

		expect(run_board_setup.read(events)).toStrictEqual({ setup: undefined, is_preparing: true })
	})

	it('stops preparing at the launch the opening led to', () => {
		const events = stream(LAUNCH_278, setup(OPENING_279), [KIND.CHILD_LAUNCH, '#279 launched'])

		expect(run_board_setup.read(events).is_preparing).toBe(false)
	})

	it('does not read a hand-off between two children as preparing one', () => {
		const events = stream(LAUNCH_278, MERGE_278, setup(STAGE.HANDING_OFF))

		expect(run_board_setup.read(events).is_preparing).toBe(false)
	})
})

describe('run_board_setup.is_lane_pending', () => {
	it('holds every lane back while the run has launched nothing', () => {
		const events = stream(setup(STAGE.HANDING_OFF))

		expect(run_board_setup.is_lane_pending(events, 278)).toBe(true)
	})

	it('holds back the lane a stage names, and no other, once a child has launched', () => {
		const events = stream(setup(OPENING_278), LAUNCH_278, setup(OPENING_279))

		expect(run_board_setup.is_lane_pending(events, 279)).toBe(true)
		expect(run_board_setup.is_lane_pending(events, 300)).toBe(false)
	})

	it('holds nothing back on a stream with no stage, so a restored run reads as before', () => {
		expect(run_board_setup.is_lane_pending([], 278)).toBe(false)
		expect(run_board_setup.is_lane_pending(stream(MERGE_278), 278)).toBe(false)
	})
})
