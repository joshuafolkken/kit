import { describe, expect, it, vi } from 'vitest'
import { run_wake_takeover, type TakeoverPorts } from './run-wake-takeover'

// joshuafolkken/kit#4509: a reload's successor has taken the run over only once it holds the wake
// record; one that died, or never claimed it, is a failed reload.

const SUCCESSOR_PID = 5151
const OLD_PID = 4242
const ATTEMPTS = 3

function ports_of(holders: ReadonlyArray<number | undefined>, is_alive = true): TakeoverPorts {
	const reads = [...holders]

	return {
		holder_pid: () => (reads.length > 1 ? reads.shift() : reads[0]),
		is_alive: () => is_alive,
		stop: vi.fn(),
		sleeper: vi.fn(async () => undefined),
	}
}

describe('run_wake_takeover.await_takeover', () => {
	it('answers taken once the successor holds the record', async () => {
		const ports = ports_of([undefined, SUCCESSOR_PID])

		await expect(run_wake_takeover.await_takeover(SUCCESSOR_PID, ports, ATTEMPTS)).resolves.toBe(
			'taken',
		)
		expect(ports.sleeper).toHaveBeenCalledOnce()
	})

	it('answers died without waiting out the bound when the successor exited unclaimed', async () => {
		const ports = ports_of([undefined], false)

		await expect(run_wake_takeover.await_takeover(SUCCESSOR_PID, ports, ATTEMPTS)).resolves.toBe(
			'died',
		)
		expect(ports.sleeper).not.toHaveBeenCalled()
	})

	it('answers unclaimed when a live successor never took the record within the bound', async () => {
		const ports = ports_of([OLD_PID])

		await expect(run_wake_takeover.await_takeover(SUCCESSOR_PID, ports, ATTEMPTS)).resolves.toBe(
			'unclaimed',
		)
		expect(ports.sleeper).toHaveBeenCalledTimes(ATTEMPTS - 1)
	})
})

describe('run_wake_takeover.await_takeover stopping the successor', () => {
	it('stops a successor still unclaimed at the bound, so it cannot claim a run warned of as stranded', async () => {
		const ports = ports_of([OLD_PID])

		await run_wake_takeover.await_takeover(SUCCESSOR_PID, ports, ATTEMPTS)

		expect(ports.stop).toHaveBeenCalledWith(SUCCESSOR_PID)
	})

	it.each([
		['taken', [SUCCESSOR_PID], true],
		['died', [undefined], false],
	] as const)('leaves a successor that %s alone', async (_result, holders, is_alive) => {
		const ports = ports_of(holders, is_alive)

		await run_wake_takeover.await_takeover(SUCCESSOR_PID, ports, ATTEMPTS)

		expect(ports.stop).not.toHaveBeenCalled()
	})
})
