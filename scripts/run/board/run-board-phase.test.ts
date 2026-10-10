import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { describe, expect, it } from 'vitest'
import { run_board_phase, type Phase } from './run-board-phase'

// joshuafolkken/kit#3444: which phase one event marks. joshuafolkken/kit#3526: every ship stage its own
// phase, and the phases a history in which a failed ship folds into 🚢💥.

const KIND = run_event_stream.EVENT_KIND
const { PHASE, STAGE } = run_ship_stage
const { history_after, phase_of } = run_board_phase

function event_of(kind: string, text: string): RunEvent {
	return { pos: 1, at: '2026-10-08T09:00:00.000Z', kind, text }
}

function ship(
	stage: (typeof STAGE)[keyof typeof STAGE],
	phase: (typeof PHASE)[keyof typeof PHASE] = PHASE.START,
	started: ReadonlyArray<(typeof STAGE)[keyof typeof STAGE]> = [],
): RunEvent {
	return event_of(KIND.SHIP_STAGE, run_ship_stage.event_text('3444', stage, phase, started))
}

function history_of(...phases: ReadonlyArray<Phase>): Array<Phase> {
	let track: Array<Phase> = []

	for (const phase of phases) track = history_after(track, phase)

	return track
}

describe('run_board_phase.phase_of', () => {
	it('reads plan, implement, the ship launch and its stop from their own records', () => {
		expect(phase_of(event_of(KIND.PLAN, 'planned #3444'))).toBe('plan')
		expect(phase_of(event_of(KIND.LANE_PHASE, '#3444 implement'))).toBe('implement')
		expect(phase_of(event_of(KIND.SHIP_LAUNCH, '#3444 ship supervisor launched'))).toBe('ship')
		expect(phase_of(event_of(KIND.SHIP_STOP, '#3444 review failed'))).toBe('failed')
	})

	it.each([
		[STAGE.PREFLIGHT, 'ship'],
		[STAGE.REVIEW, 'review'],
		[STAGE.GATE, 'gate'],
		[STAGE.SYNC, 'sync'],
		[STAGE.COMMIT, 'commit'],
		[STAGE.ROUND_TWO, 'round_two'],
		[STAGE.FOLLOWUP, 'followup'],
		[STAGE.REPORT, 'report'],
	])('reads the ship stage %s as %s when it starts', (stage, phase) => {
		expect(phase_of(ship(stage))).toBe(phase)
	})

	it('marks no phase for a stage that finished, failed or was passed over', () => {
		expect(phase_of(ship(STAGE.GATE, PHASE.DONE))).toBeUndefined()
		expect(phase_of(ship(STAGE.GATE, PHASE.FAILED))).toBeUndefined()
		expect(phase_of(ship(STAGE.COMMIT, PHASE.SKIPPED))).toBeUndefined()
	})

	it('marks no phase for an event that names none', () => {
		expect(phase_of(event_of(KIND.NOTE, '#3444 a note'))).toBeUndefined()
		expect(phase_of(event_of(KIND.LANE_PHASE, '#3444 bogus'))).toBeUndefined()
	})
})

describe('run_board_phase.history_after', () => {
	it('writes each phase after the last, going back to implement as well as forward', () => {
		expect(history_of('investigate', 'plan', 'implement', 'ship', 'review')).toStrictEqual([
			'investigate',
			'plan',
			'implement',
			'ship',
			'review',
		])
		expect(history_of('gate', 'implement')).toStrictEqual(['gate', 'implement'])
	})

	it('writes the same phase twice in a row once', () => {
		expect(history_of('implement', 'ship', 'ship', 'review', 'review')).toStrictEqual([
			'implement',
			'ship',
			'review',
		])
	})

	it('folds a failed ship’s stages into ship and failed', () => {
		const track = history_of('implement', 'ship', 'review', 'gate', 'failed', 'implement', 'ship')

		expect(track).toStrictEqual(['implement', 'ship', 'failed', 'implement', 'ship'])
	})

	it('folds only the newest ship, keeping an earlier failed round', () => {
		const track = history_of('ship', 'failed', 'implement', 'ship', 'review', 'failed')

		expect(track).toStrictEqual(['ship', 'failed', 'implement', 'ship', 'failed'])
	})

	it('writes failed alone where no ship launch was recorded', () => {
		expect(history_of('implement', 'failed')).toStrictEqual(['failed'])
	})
})

// joshuafolkken/kit#3552: a stage line that carries its attempt redraws that attempt on the track.
describe('run_board_phase.attempt_of', () => {
	const { attempt_of } = run_board_phase

	it('reads the phases a stage line lists, led by the ship’s own start', () => {
		const line = ship(STAGE.GATE, PHASE.DONE, [STAGE.PREFLIGHT, STAGE.GATE])

		expect(attempt_of(line)).toStrictEqual(['ship', 'gate'])
		expect(attempt_of(ship(STAGE.REPORT, PHASE.DONE, [STAGE.REPORT]))).toStrictEqual([
			'ship',
			'report',
		])
	})

	it('reads none off a three-word line or another kind', () => {
		expect(attempt_of(ship(STAGE.GATE))).toBeUndefined()
		expect(attempt_of(event_of(KIND.LANE_PHASE, '#3444 implement a,b'))).toBeUndefined()
	})
})

describe('run_board_phase.replayed', () => {
	const { replayed } = run_board_phase

	it('redraws the current attempt in the order the line lists', () => {
		expect(
			replayed(['implement', 'ship', 'gate'], ['ship', 'sync', 'gate', 'commit']),
		).toStrictEqual(['implement', 'ship', 'sync', 'gate', 'commit'])
	})

	it('adds a restarted ship’s stages after the ones it passed over', () => {
		expect(replayed(['ship', 'review', 'gate'], ['ship', 'commit'])).toStrictEqual([
			'ship',
			'review',
			'gate',
			'commit',
		])
	})

	it('redraws a supervisor restarted with no stop between as one attempt', () => {
		expect(
			replayed(['implement', 'ship', 'review', 'gate', 'ship'], ['ship', 'review', 'gate', 'sync']),
		).toStrictEqual(['implement', 'ship', 'review', 'gate', 'sync'])
	})

	it('starts a new attempt after a failed one, leaving the failed one as it was', () => {
		expect(replayed(['ship', 'failed', 'implement'], ['ship', 'review'])).toStrictEqual([
			'ship',
			'failed',
			'implement',
			'ship',
			'review',
		])
	})
})
