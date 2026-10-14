import { claude_lane_broker } from '#scripts/lane/claude-lane-broker'
import { afterEach, expect, it, vi } from 'vitest'
import type { WakeContext } from './run-wake-describe'
import type { LoopPorts, LoopStop } from './run-wake-loop'
import { run_wake_restart } from './run-wake-restart'
import { run_wake_supervise } from './run-wake-supervise'

// joshuafolkken/kit#3817: the Claude lanes are brokered for the supervisor's whole life, so a lane's ship
// reaching its review while the drive has handed back still finds a broker holding the token.

const CONTEXT: WakeContext = {
	carry_target: '/stub/carry.json',
	ended_target: '/stub/ended.json',
	wake_target: '/stub/wake.json',
	log_target: '/stub/wake.log',
	event_target: '/stub/events.jsonl',
	git_directory: '/stub/repo/.git',
	worktree: '/stub/repo',
}
const STOPPED: LoopStop = { reason: 'stopped', note: undefined }
const PORTS: LoopPorts = {
	read_carry: vi.fn(),
	is_owner_live: vi.fn(),
	has_work: vi.fn(),
	new_session_id: vi.fn(),
	hand_off: vi.fn(),
	drive: vi.fn(),
	wake: vi.fn(),
	sleep: vi.fn(),
	now: vi.fn(),
}
const OPENED = 'broker opened'
const SUPERVISED = 'supervised'
const CLOSED = 'broker closed'

afterEach(() => {
	vi.restoreAllMocks()
})

it('runs the restarting loop inside the Claude lane broker and returns its stop', async () => {
	const order: Array<string> = []

	vi.spyOn(claude_lane_broker, 'serve_during').mockImplementation(async (run) => {
		order.push(OPENED)
		const result = await run()

		order.push(CLOSED)

		return result
	})
	vi.spyOn(run_wake_restart, 'supervise').mockImplementation(async () => {
		order.push(SUPERVISED)

		return STOPPED
	})

	const stop = await run_wake_supervise.supervise({
		context: CONTEXT,
		ports: PORTS,
		interval_ms: 0,
		note: vi.fn(),
	})

	expect(stop).toBe(STOPPED)
	expect(order).toStrictEqual([OPENED, SUPERVISED, CLOSED])
})
