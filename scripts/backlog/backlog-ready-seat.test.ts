import { lane_capacity } from '#scripts/lane/lane-capacity'
import { lane_process_table } from '#scripts/lane/lane-process-table'
import type { LaneInfo } from '#scripts/lane/lane-registry'
import { lane_snapshot_trace } from '#scripts/lane/lane-snapshot-trace'
import { lane_spent } from '#scripts/lane/lane-spent'
import { lane_state } from '#scripts/lane/lane-state'
import { PROCESS_NONE } from '#scripts/run/run-liveness'
import { afterEach, expect, it, vi } from 'vitest'
import { backlog_ready } from './backlog-ready'

const SEATS = 9
const LIMIT = 4

function lane(seat: number): LaneInfo {
	return {
		issue: String(seat),
		branch: `${String(seat)}-lane`,
		directory: `/lanes/${String(seat)}`,
		seat,
		seat_held: seat === 1,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	}
}

afterEach(() => {
	vi.restoreAllMocks()
})

it('offers new work beside nine saved trees with only one running lane', async () => {
	const lanes = Array.from({ length: SEATS }, (_unused, index) => lane(index + 1))
	const records = new Map(
		lanes.map((entry) => [
			entry.issue,
			{
				issue: entry.issue,
				state: 'running' as const,
				changed_at: '',
				changed_by: '',
			},
		]),
	)

	vi.spyOn(lane_process_table, 'read_table').mockResolvedValue([])
	vi.spyOn(lane_snapshot_trace, 'traces_of').mockResolvedValue(() => PROCESS_NONE)
	vi.spyOn(lane_snapshot_trace, 'merge_waits_of').mockResolvedValue(() => false)
	vi.spyOn(lane_state, 'read_states').mockResolvedValue(records)
	vi.spyOn(lane_spent, 'idle_lanes').mockReturnValue(lanes.slice(1).map((entry) => entry.issue))
	vi.spyOn(lane_capacity, 'lane_limit').mockResolvedValue({ kind: 'limit', limit: LIMIT })

	await expect(backlog_ready.free_lanes_beside(lanes)).resolves.toBe(LIMIT - 1)
})
