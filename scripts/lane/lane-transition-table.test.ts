import { describe, expect, it } from 'vitest'
import { lane_state } from './lane-state'
import { lane_state_record, type LaneState } from './lane-state-record'
import { lane_transition_table } from './lane-transition-table'

const { HUMAN_REVIEW, LANE_STATES } = lane_state_record
const { LANE_EVENT_NAMES, LANE_GUARDS, allowed_transitions, next_state, row_of } =
	lane_transition_table

// The allowed transitions as `lane-state.ts` spelled them before the table derived them.
const EXPECTED: Record<LaneState, ReadonlyArray<LaneState>> = {
	open: ['open', 'running', 'paused', HUMAN_REVIEW, 'ended'],
	running: ['running', 'paused', HUMAN_REVIEW, 'ended'],
	paused: ['paused', 'running', 'ended'],
	[HUMAN_REVIEW]: [HUMAN_REVIEW, 'running', 'ended'],
	ended: ['ended', 'open'],
}

const PAIRS = LANE_STATES.flatMap((from) =>
	LANE_STATES.map((to): [LaneState, LaneState] => [from, to]),
)

describe('lane_transition_table', () => {
	it('derives the same allowed targets for every state as the table it replaced', () => {
		const derived = allowed_transitions()

		for (const state of LANE_STATES) {
			expect(new Set(derived[state])).toStrictEqual(new Set(EXPECTED[state]))
		}
	})

	it.each(PAIRS)('answers is_allowed(%s, %s) as the replaced table did', (from, to) => {
		expect(lane_state.is_allowed(from, to)).toBe(EXPECTED[from].includes(to))
	})

	it('still lets a lane with no record move to any state', () => {
		for (const state of LANE_STATES) expect(lane_state.is_allowed(undefined, state)).toBe(true)
	})

	it('answers every event in every state with a next state or an explicit rejection', () => {
		for (const event of LANE_EVENT_NAMES) {
			for (const state of LANE_STATES) {
				const next = next_state(state, event)
				const is_rejection = next === undefined

				expect(is_rejection || LANE_STATES.includes(next)).toBe(true)
				expect(is_rejection).toBe(!row_of(event).from.includes(state))
			}
		}
	})

	it('takes adopt only on a lane with no record', () => {
		for (const state of LANE_STATES) expect(next_state(state, 'adopt')).toBeUndefined()
	})

	it('names only declared guards', () => {
		const used = LANE_EVENT_NAMES.flatMap((event) => row_of(event).guards)

		for (const guard of used) expect(LANE_GUARDS).toContain(guard)
	})
})

// joshuafolkken/kit#8768: the hand-over is the table's event, one per state a lane is handed over in.
describe('lane_transition_table hand-over', () => {
	it('hands over every state but ended in place, moving only the owner (ac-d6df31c5)', () => {
		const handed = lane_transition_table.hand_over_events().map((event) => row_of(event))

		expect(handed.map((row) => row.to)).toStrictEqual(['open', 'running', 'paused', HUMAN_REVIEW])
		for (const row of handed) expect(row).toMatchObject({ from: [row.to], is_owner_only: true })
	})
})
