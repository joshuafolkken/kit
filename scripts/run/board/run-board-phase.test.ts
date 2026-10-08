import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { describe, expect, it } from 'vitest'
import { run_board_phase } from './run-board-phase'

// joshuafolkken/kit#3444: which phase one event marks, and that a phase never goes back.

const KIND = run_event_stream.EVENT_KIND
const { PHASE, STAGE } = run_ship_stage

function event_of(kind: string, text: string): RunEvent {
	return { pos: 1, at: '2026-10-08T09:00:00.000Z', kind, text }
}

function ship(stage: (typeof STAGE)[keyof typeof STAGE]): RunEvent {
	return event_of(KIND.SHIP_STAGE, run_ship_stage.event_text('3444', stage, PHASE.START))
}

describe('run_board_phase.phase_of', () => {
	it('reads plan from the plan event and implement from the lane phase', () => {
		expect(run_board_phase.phase_of(event_of(KIND.PLAN, 'planned #3444'))).toBe('plan')
		expect(run_board_phase.phase_of(event_of(KIND.LANE_PHASE, '#3444 implement'))).toBe('implement')
	})

	it.each([
		[STAGE.PREFLIGHT, 'review'],
		[STAGE.REVIEW, 'review'],
		[STAGE.GATE, 'gate'],
		[STAGE.SYNC, 'commit'],
		[STAGE.COMMIT, 'commit'],
		[STAGE.ROUND_TWO, 'followup'],
		[STAGE.FOLLOWUP, 'followup'],
		[STAGE.REPORT, 'followup'],
	])('folds the ship stage %s onto %s', (stage, phase) => {
		expect(run_board_phase.phase_of(ship(stage))).toBe(phase)
	})

	it('marks no phase for an event that names none', () => {
		expect(run_board_phase.phase_of(event_of(KIND.NOTE, '#3444 a note'))).toBeUndefined()
		expect(run_board_phase.phase_of(event_of(KIND.LANE_PHASE, '#3444 bogus'))).toBeUndefined()
	})
})

describe('run_board_phase.later_of', () => {
	it('moves forward and never back', () => {
		expect(run_board_phase.later_of(undefined, 'plan')).toBe('plan')
		expect(run_board_phase.later_of('plan', 'gate')).toBe('gate')
		expect(run_board_phase.later_of('gate', 'implement')).toBe('gate')
	})
})
