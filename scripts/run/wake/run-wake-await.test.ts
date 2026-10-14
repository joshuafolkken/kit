import type { CarryRead, RunCarry } from '#scripts/run/carry/run-carry'
import { describe, expect, it, vi } from 'vitest'
import { run_wake_await, type AwaitPorts } from './run-wake-await'

// joshuafolkken/kit#3804: a supervisor `josh backlogrun` starts beside its parent waits for that parent
// to claim the carry record, and gives up once the launch is gone.

const INTERVAL_MS = 5
const CARRIED_INVOCATION = 'backlogrun #3804'
const LAUNCHED_INVOCATION = 'backlogrun #3805'
const CARRY: RunCarry = {
	invocation: CARRIED_INVOCATION,
	started_at: '2026-10-14T13:00:00.000Z',
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}
const CARRIED: CarryRead = { kind: 'carried', carry: CARRY }
const NONE: CarryRead = { kind: 'none' }

function ports_of(
	reads: ReadonlyArray<CarryRead>,
	launches: ReadonlyArray<boolean>,
	is_owner_live = true,
): AwaitPorts {
	const carry_reads = [...reads]
	const launch_reads = [...launches]

	return {
		read_carry: () => carry_reads.shift() ?? NONE,
		pending_invocation: () => (launch_reads.shift() === true ? LAUNCHED_INVOCATION : undefined),
		is_owner_live: () => is_owner_live,
		sleep: vi.fn(async () => undefined),
	}
}

// An earlier run's record whose owner is gone: a launch pending beside it is not that run.
describe('run_wake_await beside a dead owner’s carry record', () => {
	it('names the pending launch rather than the dead owner’s run', () => {
		const ports = ports_of([CARRIED], [true], false)

		expect(run_wake_await.supervised_invocation(ports)).toBe(LAUNCHED_INVOCATION)
	})

	it('names the dead owner’s run when no launch is pending, as a plain --start does', () => {
		const ports = ports_of([CARRIED], [false], false)

		expect(run_wake_await.supervised_invocation(ports)).toBe(CARRIED_INVOCATION)
	})

	it('keeps waiting while the launch is alive rather than taking the dead owner’s record', async () => {
		const ports = ports_of([CARRIED, CARRIED, NONE], [true, false], false)

		await expect(run_wake_await.await_carry(ports, INTERVAL_MS)).resolves.toStrictEqual(NONE)
		expect(ports.sleep).toHaveBeenCalledOnce()
	})
})

describe('run_wake_await.supervised_invocation', () => {
	it('names the carried run first', () => {
		expect(run_wake_await.supervised_invocation(ports_of([CARRIED], [true]))).toBe(
			CARRIED_INVOCATION,
		)
	})

	it('names the launch about to carry a run while no carry record stands', () => {
		expect(run_wake_await.supervised_invocation(ports_of([NONE], [true]))).toBe(LAUNCHED_INVOCATION)
	})

	it('names nothing when neither a carry record nor a launch stands', () => {
		expect(run_wake_await.supervised_invocation(ports_of([NONE], [false]))).toBeUndefined()
	})
})

describe('run_wake_await.await_carry', () => {
	it('waits while the launch is alive until the carry record appears', async () => {
		const ports = ports_of([NONE, NONE, CARRIED], [true, true])

		await expect(run_wake_await.await_carry(ports, INTERVAL_MS)).resolves.toStrictEqual(CARRIED)
		expect(ports.sleep).toHaveBeenCalledTimes(2)
		expect(ports.sleep).toHaveBeenCalledWith(INTERVAL_MS)
	})

	it('stops waiting once the launch is gone without a carry record', async () => {
		const ports = ports_of([NONE, NONE, NONE], [true, false])

		await expect(run_wake_await.await_carry(ports, INTERVAL_MS)).resolves.toStrictEqual(NONE)
		expect(ports.sleep).toHaveBeenCalledOnce()
	})

	it('reads the carry record once more after the launch is gone', async () => {
		const ports = ports_of([NONE, CARRIED], [false])

		await expect(run_wake_await.await_carry(ports, INTERVAL_MS)).resolves.toStrictEqual(CARRIED)
		expect(ports.sleep).not.toHaveBeenCalled()
	})
})
