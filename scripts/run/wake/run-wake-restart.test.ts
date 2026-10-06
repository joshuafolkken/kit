import { describe, expect, it, vi } from 'vitest'
import type { LoopStop } from './run-wake-loop'
import { run_wake_restart, type RestartPorts } from './run-wake-restart'

// joshuafolkken/kit#3332: a supervisor that ended `failed` on a transient error left a resumable run
// asleep until a person noticed. What these cases pin is that a failure restarts the supervisor while
// the carry record can still be continued, and that only the restart bound reaches a person.

const LIMIT = run_wake_restart.RESTART_LIMIT
const FAILED: LoopStop = { reason: 'failed', note: 'main:sync failed' }
const ENDED: LoopStop = { reason: 'ended', note: undefined }
const EXPIRED: LoopStop = { reason: 'expired', note: undefined }
const STOPPED: LoopStop = { reason: 'stopped', note: undefined }

function ports_of(stops: ReadonlyArray<LoopStop>, is_resumable = true): RestartPorts {
	const pass = vi.fn<RestartPorts['pass']>()

	for (const stop of stops) pass.mockResolvedValueOnce(stop)

	return {
		pass,
		is_resumable: vi.fn(() => is_resumable),
		pause: vi.fn(async () => undefined),
		note: vi.fn(),
	}
}

describe('run_wake_restart.supervise — a failure while the run is resumable', () => {
	it('restarts the supervisor and answers with the pass that followed', async () => {
		const ports = ports_of([FAILED, ENDED])

		expect(await run_wake_restart.supervise(ports)).toEqual(ENDED)
		expect(ports.pass).toHaveBeenCalledTimes(2)
		expect(ports.pause).toHaveBeenCalledTimes(1)
		expect(vi.mocked(ports.note).mock.calls.join('\n')).toContain('restarting it, 1 of')
	})

	it('stops restarting at the bound and hands the last failure back for the warning', async () => {
		const ports = ports_of(Array.from({ length: LIMIT + 1 }, () => FAILED))
		const stop = await run_wake_restart.supervise(ports)

		expect(stop.reason).toBe('failed')
		expect(stop.note).toContain(`after ${String(LIMIT)} automatic restarts`)
		expect(ports.pass).toHaveBeenCalledTimes(LIMIT + 1)
	})
})

describe('run_wake_restart.supervise — what is never restarted', () => {
	it('does not restart once the carry record is no longer resumable', async () => {
		const ports = ports_of([FAILED, ENDED], false)

		expect(await run_wake_restart.supervise(ports)).toEqual(FAILED)
		expect(ports.pass).toHaveBeenCalledTimes(1)
	})

	it.each([ENDED, EXPIRED])('hands a $reason stop straight back', async (stop) => {
		const ports = ports_of([stop])

		expect(await run_wake_restart.supervise(ports)).toEqual(stop)
		expect(ports.pause).not.toHaveBeenCalled()
	})

	it('ends with the person stop when a --stop lands in the pause before a restart', async () => {
		const ports = ports_of([FAILED, STOPPED, ENDED])

		expect(await run_wake_restart.supervise(ports)).toEqual(STOPPED)
		expect(ports.pass).toHaveBeenCalledTimes(2)
	})
})
