import { afterEach, describe, expect, it, vi } from 'vitest'

const sleep_mock = vi.hoisted(() => vi.fn<() => Promise<void>>())

vi.mock('node:timers/promises', () => ({ setTimeout: sleep_mock }))

const { run_ship_record_wait } = await import('./run-ship-record-wait')

const PENDING = { launch_id: 'launch' }
const READY = { ...PENDING, pid: 1 }
const ATTEMPTS = 200

afterEach(() => {
	sleep_mock.mockReset()
})

describe('run_ship_record_wait.ready_record', () => {
	it('ends immediately when the launch record disappeared', async () => {
		await expect(run_ship_record_wait.ready_record(() => undefined)).resolves.toBeUndefined()
		expect(sleep_mock).not.toHaveBeenCalled()
	})

	it('returns the claimed record after waiting on its pending predecessor', async () => {
		const read = vi.fn().mockReturnValueOnce(PENDING).mockReturnValue(READY)

		await expect(run_ship_record_wait.ready_record(read)).resolves.toStrictEqual(READY)
		expect(sleep_mock).toHaveBeenCalledOnce()
	})

	it('does not accept a claim first read after the final wait', async () => {
		const read = vi.fn(() => (sleep_mock.mock.calls.length === ATTEMPTS ? READY : PENDING))

		await expect(run_ship_record_wait.ready_record(read)).resolves.toBeUndefined()
		expect(sleep_mock).toHaveBeenCalledTimes(ATTEMPTS)
		expect(read).toHaveBeenCalledTimes(ATTEMPTS + 1)
	})
})
