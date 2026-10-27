import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { run_wake_caffeinate, type Spawner, type Started } from './run-wake-caffeinate'

const SUPERVISOR_PID = 4242
const SUPERVISOR_ARGV = ['-i', '-s', '-w', '4242']
const IDLE_SECONDS = '30'
const LIVE_TIMEOUT_MS = 10_000

interface FakeChild extends Started {
	fail: () => void
	unref: Mock<() => unknown>
}

function fake_child(): FakeChild {
	const listeners: Array<() => void> = []

	return {
		on: (_event, listener) => {
			listeners.push(listener)
		},
		unref: vi.fn<() => unknown>(),
		fail: () => {
			for (const listener of listeners) listener()
		},
	}
}

function is_present(): boolean {
	return true
}

describe('run_wake_caffeinate.argv', () => {
	it('blocks idle and system sleep for as long as the supervisor pid lives', () => {
		expect(run_wake_caffeinate.argv(SUPERVISOR_PID)).toStrictEqual(SUPERVISOR_ARGV)
	})
})

describe('run_wake_caffeinate.keep_awake', () => {
	it('starts nothing on a host without caffeinate', () => {
		const spawner = vi.fn<Spawner>()

		run_wake_caffeinate.keep_awake(SUPERVISOR_PID, () => false, spawner)

		expect(spawner).not.toHaveBeenCalled()
	})

	it('starts caffeinate detached on the supervisor pid and lets it go', () => {
		const child = fake_child()
		const spawner = vi.fn<Spawner>(() => child)

		run_wake_caffeinate.keep_awake(SUPERVISOR_PID, is_present, spawner)

		expect(spawner).toHaveBeenCalledWith(run_wake_caffeinate.CAFFEINATE_PATH, SUPERVISOR_ARGV, {
			detached: true,
			stdio: 'ignore',
		})
		expect(child.unref).toHaveBeenCalledOnce()
	})

	it('swallows a spawn that fails after it started', () => {
		const child = fake_child()

		run_wake_caffeinate.keep_awake(SUPERVISOR_PID, is_present, () => child)

		expect(() => {
			child.fail()
		}).not.toThrow()
	})
})

describe('run_wake_caffeinate.keep_awake on a host with caffeinate', () => {
	it.runIf(existsSync(run_wake_caffeinate.CAFFEINATE_PATH))(
		'ends with the process it watches',
		async () => {
			const watched = spawn('sleep', [IDLE_SECONDS], { stdio: 'ignore' })
			const started: Array<ChildProcess> = []

			run_wake_caffeinate.keep_awake(watched.pid ?? 0, existsSync, (command, args, options) => {
				const child = spawn(command, args, options)

				started.push(child)

				return child
			})

			const exited = started.map(async (child) => {
				await once(child, 'exit')
			})

			watched.kill()

			await expect(Promise.all(exited)).resolves.toHaveLength(1)
		},
		LIVE_TIMEOUT_MS,
	)
})
