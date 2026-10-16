import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaneInfo } from './lane-registry'
import { lane_relaunch } from './lane-relaunch'
import { lane_session_action, type BrokerAnswer } from './lane-session-action'

const argv_mock = vi.hoisted(() => vi.fn())
const launch_mock = vi.hoisted(() => vi.fn())
const parked_mock = vi.hoisted(() => vi.fn())
const ROUND_ONE = { kind: 'review', round: '1' } as const
const RELAUNCH = {
	kind: 'relaunch',
	stop: { stage: 'review', title: 'Address the review', flags: [], is_review: true, conflicts: [] },
} as const
const LANE: LaneInfo = {
	issue: '3974',
	directory: '/registered/lane',
	branch: '3974-lane',
	seat: undefined,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
	profile: undefined,
}

vi.mock('#scripts/agent/agent-argv', () => ({ agent_argv: { resolve_in: argv_mock } }))
vi.mock('#scripts/run/detached-launch', () => ({
	detached_launch: { launch_attached: launch_mock },
}))
vi.mock('./lane-parked', () => ({ lane_parked: { is_parked: parked_mock } }))

beforeEach(() => {
	argv_mock.mockReset().mockReturnValue({
		kind: 'argv',
		argv: { command: 'claude', args: [] },
		profile: { provider: 'anthropic', role: 'reviewer', model: 'opus', effort: 'high' },
	})
	launch_mock.mockReset().mockResolvedValue({ kind: 'completed', pid: 1, exit_code: 0 })
	parked_mock.mockReset().mockResolvedValue(false)
})

afterEach(() => {
	vi.restoreAllMocks()
})

function reason_of(answer: BrokerAnswer): string {
	return answer.is_success ? '' : answer.reason
}

describe('lane_session_action.answer', () => {
	it('answers success when the reviewer exits cleanly', async () => {
		const answer = await lane_session_action.answer(LANE, ROUND_ONE)

		expect(answer).toStrictEqual(lane_session_action.SUCCESS)
	})

	it('names the reviewer exit code when it fails', async () => {
		launch_mock.mockResolvedValue({ kind: 'completed', pid: 1, exit_code: 2 })

		const answer = await lane_session_action.answer(LANE, ROUND_ONE)

		expect(reason_of(answer)).toBe('the reviewer exited with code 2')
	})

	it('refuses a parked issue', async () => {
		parked_mock.mockResolvedValue(true)

		const answer = await lane_session_action.answer(LANE, RELAUNCH)

		expect(reason_of(answer)).toBe('the issue is parked')
	})

	it('names the note of a rejected relaunch', async () => {
		vi.spyOn(lane_relaunch, 'relaunch').mockReturnValue({ kind: 'rejected', note: 'no profile' })

		const answer = await lane_session_action.answer(LANE, RELAUNCH)

		expect(reason_of(answer)).toBe('the relaunch did not start: no profile')
	})

	it('answers a thrown action as a failure naming its error', async () => {
		vi.spyOn(lane_relaunch, 'relaunch').mockImplementation(() => {
			throw new Error('spawn EACCES')
		})

		const answer = await lane_session_action.answer(LANE, RELAUNCH)

		expect(reason_of(answer)).toBe('the broker failed: spawn EACCES')
	})
})
