import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_seat_fixture } from './lane-seat-fixture'

const order = vi.hoisted((): Array<string> => [])
const launch_mock = vi.hoisted(() => vi.fn())
const running_mock = vi.hoisted(() => vi.fn<(issue: string) => boolean>())
const stop_mock = vi.hoisted(() => vi.fn<(lane: unknown) => Array<number>>())
const end_residents_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/agent/agent-argv', () => ({
	agent_argv: {
		resume_argv: () => ({
			kind: 'argv',
			argv: { command: 'claude', args: [] },
			profile: undefined,
		}),
	},
}))
vi.mock('#scripts/run/detached-launch', () => ({ detached_launch: { launch: launch_mock } }))
vi.mock('./lane-dispatch-log', () => ({
	lane_dispatch_log: { default_log_path: () => '/lanes/8843/lane.log' },
}))
vi.mock('./lane-reap', () => ({
	lane_reap: { is_child_running: running_mock, reap_child: stop_mock },
}))
vi.mock('./lane-reap-settle', () => ({ lane_reap_settle: { GRACE_MS: 0 } }))
vi.mock('./lane-residents', () => ({ lane_residents: { end_residents: end_residents_mock } }))

const { lane_relaunch } = await import('./lane-relaunch')

const LANE = { issue: '8843', directory: '/lanes/8843', profile: undefined }

function answers(...running: ReadonlyArray<boolean>): void {
	for (const answer of running) running_mock.mockReturnValueOnce(answer)
}

async function relaunch(lane: object = LANE): Promise<unknown> {
	return await lane_relaunch.relaunch(lane as never, 'fullrun #8843', 'implementation', vi.fn())
}

beforeEach(() => {
	lane_seat_fixture.mock_start()
	order.length = 0
	running_mock.mockReset().mockReturnValue(false)
	stop_mock.mockReset().mockImplementation(() => {
		order.push('stop')

		return [1]
	})
	launch_mock.mockReset().mockImplementation(() => {
		order.push('launch')

		return { kind: 'launched', pid: 2 }
	})
})

// joshuafolkken/kit#8843: a relaunch beside a live child put two children in one lane, each running
// its own gate.
describe('lane_relaunch.relaunch with a previous child', () => {
	it('stops the live child before launching exactly one', async () => {
		answers(true, false)

		await expect(relaunch()).resolves.toMatchObject({ kind: 'launched' })
		expect(order).toStrictEqual(['stop', 'launch'])
		expect(stop_mock).toHaveBeenCalledWith(LANE)
	})

	// A broker relaunches on a detached ship supervisor's behalf; that supervisor runs from the lane
	// outside the broker's ancestry, so ending the lane's residents would end the requester.
	it('ends the child’s tree only, leaving the lane’s residents running', async () => {
		answers(true, false)

		await relaunch()

		expect(end_residents_mock).not.toHaveBeenCalled()
	})

	it('launches without stopping anything when no child runs', async () => {
		await expect(relaunch()).resolves.toMatchObject({ kind: 'launched' })
		expect(order).toStrictEqual(['launch'])
	})

	it('refuses the launch when the child outlives the stop', async () => {
		running_mock.mockReturnValue(true)

		await expect(relaunch()).resolves.toMatchObject({
			kind: 'rejected',
			note: expect.stringContaining('still runs') as unknown,
		})
		expect(launch_mock).not.toHaveBeenCalled()
	})

	it('leaves an OpenAI lane to its supervisor', async () => {
		running_mock.mockReturnValue(true)

		await relaunch({ ...LANE, profile: { provider: 'openai' } })

		expect(stop_mock).not.toHaveBeenCalled()
	})
})
