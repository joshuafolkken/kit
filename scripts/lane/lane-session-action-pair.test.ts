import { core_priority } from '#scripts/gate/core-priority'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_child_marker } from './lane-child-marker'
import type { LaneInfo } from './lane-registry'
import { lane_session_action } from './lane-session-action'

// joshuafolkken/kit#7020: a lane's broker starts the paired reviewer beside round 1's code reviewer,
// and its answer stays the code reviewer's.

const argv_mock = vi.hoisted(() => vi.fn())
const launch_mock = vi.hoisted(() => vi.fn())
const pair_launch = vi.hoisted(() => vi.fn())
const LANE: LaneInfo = {
	issue: '7020',
	directory: '/registered/lane',
	branch: '7020-lane',
	seat: undefined,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
	profile: undefined,
}

vi.mock('#scripts/agent/agent-argv', () => ({ agent_argv: { review_in: argv_mock } }))
vi.mock('#scripts/run/detached-launch', () => ({
	detached_launch: { launch_attached: launch_mock },
}))
vi.mock('#scripts/review/review-pair-session', () => ({
	review_pair_session: { launch: pair_launch },
}))
vi.mock('./lane-parked', () => ({ lane_parked: { is_parked: async () => false } }))

beforeEach(() => {
	argv_mock.mockReset().mockReturnValue({
		kind: 'argv',
		argv: { command: 'claude', args: [] },
		profile: { provider: 'anthropic', role: 'reviewer', model: 'opus', effort: 'high' },
	})
	launch_mock.mockReset().mockResolvedValue({ kind: 'completed', pid: 1, exit_code: 0 })
	pair_launch.mockReset().mockResolvedValue(undefined)
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
})

describe('lane_session_action.answer — the paired reviewer', () => {
	it("starts it beside round 1's code reviewer with the reviewer environment", async () => {
		const answer = await lane_session_action.answer(LANE, { kind: 'review', round: '1' })

		expect(answer).toStrictEqual(lane_session_action.SUCCESS)
		expect(pair_launch).toHaveBeenCalledWith(LANE.directory, {
			...lane_child_marker.env_for(LANE.issue),
			...core_priority.PRIORITY_ENVIRONMENT,
		})
	})

	it('starts none for round 2 or an interaction review alone', async () => {
		await lane_session_action.answer(LANE, { kind: 'review', round: '2' })
		await lane_session_action.answer(LANE, {
			kind: 'review',
			round: '1',
			slots: ['interaction'],
		})

		expect(pair_launch).not.toHaveBeenCalled()
	})
})
