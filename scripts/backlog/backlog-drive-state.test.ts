import { lane_await } from '#scripts/lane/lane-await'
import { describe, expect, it } from 'vitest'
import { backlog_drive_state } from './backlog-drive-state'

const CHILD = '2400'
const ACTIVE = '2026-11-06T00:00:00Z'
const SETTLING_MS = 2 * lane_await.RECONFIRM_MS

describe('backlog_drive_state', () => {
	it('copies the in-flight list and starts with no stopped or excluded children', () => {
		const children = [CHILD]
		const state = backlog_drive_state.initial_state(children, ACTIVE)

		children.pop()
		expect(state).toStrictEqual({
			in_flight: [CHILD],
			exclude: [],
			active: ACTIVE,
			retries: 0,
			is_stopping: false,
			settling_until_ms: Date.parse(ACTIVE) + SETTLING_MS,
		})
	})

	it('settles nothing when no earlier child is seeded', () => {
		expect(backlog_drive_state.initial_state([], ACTIVE).settling_until_ms).toBeUndefined()
	})

	it('preserves the first stop when another child ends', () => {
		const state = backlog_drive_state.initial_state([], ACTIVE)
		const stopped = backlog_drive_state.merge_stopped(CHILD, state)

		expect(stopped.stopped_by).toBe(CHILD)
		expect(stopped.stop_reason).toContain(CHILD)
		expect(backlog_drive_state.merge_stopped('2500', stopped)).toBe(stopped)
	})
})
