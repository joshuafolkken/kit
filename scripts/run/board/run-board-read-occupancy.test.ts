import { lane_registry } from '#scripts/lane/lane-registry'
import { lane_spent } from '#scripts/lane/lane-spent'
import { lane_state } from '#scripts/lane/lane-state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_read } from './run-board-read'
import { run_board_read_fixture } from './run-board-read-fixture'

const { CARRY, ENDED_AT, arrange, lane } = run_board_read_fixture
const WORKING = '3432'
const IDLE = '3433'
const DISPATCH = 'lane:dispatch'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_read.read_local worker occupancy', () => {
	it('reads occupied identities beside the count from the same snapshot', async () => {
		arrange({ kind: 'carried', carry: CARRY }, undefined)
		vi.mocked(lane_state.read_states).mockResolvedValue(
			new Map([
				[
					WORKING,
					{
						issue: WORKING,
						state: 'running',
						changed_at: ENDED_AT,
						changed_by: DISPATCH,
						launched_at: ENDED_AT,
					},
				],
			]),
		)
		const local = await run_board_read.read_local()
		if (local === undefined) throw new Error('Missing local read')

		expect(local.occupied_lanes).toEqual([WORKING])
		expect(local.occupied_lanes).toHaveLength(local.occupied_count ?? 0)
	})
})

describe('run_board_read.read_local idle occupancy', () => {
	it.each(['running', 'human-review'] as const)(
		'excludes a lane without a worker recorded %s from the heading (ac-8a800d88)',
		async (state) => {
			arrange({ kind: 'carried', carry: CARRY }, undefined)
			vi.mocked(lane_registry.list_lanes).mockResolvedValue([lane(WORKING), lane(IDLE)])
			vi.mocked(lane_spent.idle_lanes).mockReturnValue([IDLE])
			vi.mocked(lane_state.read_states).mockResolvedValue(
				new Map([[IDLE, { issue: IDLE, state, changed_at: ENDED_AT, changed_by: DISPATCH }]]),
			)

			await expect(run_board_read.read_local()).resolves.toMatchObject({
				occupied_count: 1,
				occupied_lanes: [WORKING],
				free_lanes: run_board_read_fixture.LANE_LIMIT - 1,
			})
		},
	)
})
