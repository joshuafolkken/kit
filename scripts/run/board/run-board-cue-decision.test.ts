import { describe, expect, it } from 'vitest'
import { run_board_cue_decision, type CueDecision } from './run-board-cue-decision'
import { run_board_fixture } from './run-board-fixture'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'

const { decided } = run_board_cue_decision
const { plan_titled } = run_board_fixture
const { EMPTY_LAYOUT, NOW, header } = run_board_render_fixture
const { FRESH_STATE } = run_board_tick

function planned(): BoardState {
	return { ...FRESH_STATE, plan: plan_titled('a') }
}

function row(number: number, state: BoardRow['state']): BoardRow {
	return { number, title: undefined, kind: undefined, state, status: undefined, waits: [] }
}

// The decision a frame over `rows` makes after `state`, carried into the state the next frame starts from.
function frame(state: BoardState, rows: ReadonlyArray<BoardRow>): [BoardState, CueDecision] {
	const decision = decided(state, header({ layout: { ...EMPTY_LAYOUT, active: rows } }), [], NOW)
	const { sound_snapshot, sound_pending, notice } = decision

	return [{ ...state, sound_snapshot, sound_pending, notice }, decision]
}

// joshuafolkken/kit#8178: the cue `sounded` plays, decided without the board's ports.
describe('run_board_cue_decision.decided', () => {
	it('picks a launch on the frame a lane starts on, and nothing while it runs', () => {
		const [before] = frame(planned(), [])
		const [launched, launch] = frame(before, [row(1, 'running')])
		const [, still] = frame(launched, [row(1, 'running')])

		expect(launch.cue).toBe('launch')
		expect(still.cue).toBeUndefined()
	})

	it('picks nothing on the first frame over a wait on a person and a stopped lane', () => {
		const [, first] = frame(planned(), [row(1, 'human'), row(2, 'stopped')])

		expect(first.cue).toBeUndefined()
		expect(first.sound_snapshot).toBeDefined()
	})

	it('picks nothing on the frame the plan arrives on with a wait already there', () => {
		const [before, unplanned] = frame({ ...planned(), plan: undefined }, [])
		const [, arrived] = frame({ ...before, plan: plan_titled('a') }, [row(1, 'human')])

		expect(unplanned.sound_snapshot).toBeUndefined()
		expect(arrived.cue).toBeUndefined()
	})

	it('keeps the picked launch as the notice', () => {
		const [before] = frame(planned(), [])
		const [, launch] = frame(before, [row(1, 'running')])

		expect(launch.notice?.cause).toStrictEqual({ cue: 'launch', word: 'running', issue: 1 })
	})
})
