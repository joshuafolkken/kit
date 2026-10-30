import { auto_ok_fixture, CREATED_EARLIER } from '#scripts/auto-ok/auto-ok-fixture'
import { IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { lane_process_table } from '#scripts/lane/lane-process-table'
import { lane_registry } from '#scripts/lane/lane-registry'
import { lane_state } from '#scripts/lane/lane-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BusyRead } from './epic-busy'
import { epic_lane_occupancy } from './epic-lane-occupancy'
import { epic_stopped_fixture } from './epic-stopped-fixture'

const { RUNNING, STOPPED, lane, record, records } = epic_stopped_fixture

function reading(): BusyRead {
	return {
		kind: 'busy',
		issues: [RUNNING, STOPPED].map((issue) =>
			auto_ok_fixture.issue(Number(issue), CREATED_EARLIER, [IN_PROGRESS_LABEL]),
		),
	}
}

beforeEach(epic_stopped_fixture.arrange)
afterEach(() => vi.restoreAllMocks())

describe('epic_lane_occupancy.read', () => {
	it('excludes a confirmed stopped local holder without changing its label or tree', async () => {
		const original = reading()
		const result = await epic_lane_occupancy.read(original, true)

		expect(result.read).toMatchObject({ kind: 'busy', issues: [{ number: Number(RUNNING) }] })
		expect(result.use).toMatchObject({ occupied: 1, seated: 1 })
		expect(original.kind === 'busy' && original.issues).toHaveLength(epic_stopped_fixture.LIMIT)
	})

	it('keeps a local holder with unknown state even when no process is visible', async () => {
		vi.mocked(lane_state.read_states).mockResolvedValue(new Map([[RUNNING, record(RUNNING)]]))

		const result = await epic_lane_occupancy.read(reading(), true)

		expect(result.read).toEqual(reading())
		expect(result.use?.occupied).toBe(epic_stopped_fixture.LIMIT)
	})

	it('does not double count an unknown holder whose process is visible', async () => {
		vi.mocked(lane_state.read_states).mockResolvedValue(new Map([[STOPPED, record(STOPPED)]]))

		const result = await epic_lane_occupancy.read(reading(), true)

		expect(result.use?.occupied).toBe(1)
	})
})

describe('epic_lane_occupancy.read — protected holders', () => {
	it('keeps human review after its process exits', async () => {
		const states = records()

		states.set(STOPPED, record(STOPPED, 'human-review'))
		vi.mocked(lane_state.read_states).mockResolvedValue(states)

		const result = await epic_lane_occupancy.read(reading(), true)

		expect(result.use?.occupied).toBe(epic_stopped_fixture.LIMIT)
	})

	it('keeps a holder whose seat is still held', async () => {
		vi.mocked(lane_registry.list_lanes).mockResolvedValue([
			lane(RUNNING),
			{ ...lane(STOPPED), seat_held: true },
		])

		const result = await epic_lane_occupancy.read(reading(), true)

		expect(result.read).toEqual(reading())
		expect(result.use?.seated).toBe(epic_stopped_fixture.LIMIT)
	})

	it('keeps every process holder when the process table cannot be read', async () => {
		vi.mocked(lane_process_table.read_table).mockResolvedValue(undefined)

		const result = await epic_lane_occupancy.read(reading(), true)

		expect(result.use?.occupied).toBe(epic_stopped_fixture.LIMIT)
	})
})

describe('epic_lane_occupancy.read — unreadable and foreign lanes', () => {
	it('retains the conservative listing on a failed local read', async () => {
		vi.mocked(lane_registry.list_lanes).mockRejectedValue(new Error('unreadable'))

		expect(await epic_lane_occupancy.read(reading(), true)).toEqual({ read: reading() })
	})

	it('does not discount another machine without a local lane', async () => {
		vi.mocked(lane_registry.list_lanes).mockResolvedValue([])

		expect(await epic_lane_occupancy.read(reading(), true)).toEqual({ read: reading() })
	})

	it('does not match another repository by local issue number', async () => {
		expect(await epic_lane_occupancy.read(reading(), false)).toEqual({ read: reading() })
		expect(lane_registry.list_lanes).not.toHaveBeenCalled()
	})

	it.each(['unreadable', 'truncated', 'idle'] as const)('preserves the %s answer', async (kind) => {
		expect(await epic_lane_occupancy.read({ kind }, true)).toEqual({ read: { kind } })
		expect(lane_registry.list_lanes).not.toHaveBeenCalled()
	})
})
