import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { run_wake } from './run-wake'
import { run_wake_stop } from './run-wake-stop'

// joshuafolkken/kit#3708: the supervisor's stop, shared by `run:wake --stop` and `josh backlogrun --stop`.

const scratch = mkdtempSync(path.join(tmpdir(), 'run-wake-stop-test-'))
const TARGET = path.join(scratch, 'wake.json')
const INVOCATION = 'backlogrun --max 5'
const NOW = new Date('2026-10-12T09:00:00.000Z')
const SUPERVISOR_PID = 4242

afterEach(() => {
	vi.restoreAllMocks()
	run_wake.remove_wake(TARGET)
})

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

function write_wake(): void {
	run_wake.write_wake(TARGET, { ...run_wake.fresh_wake(INVOCATION, NOW), pid: SUPERVISOR_PID })
}

describe('run_wake_stop.stop', () => {
	it('answers nothing and signals nobody where there is no record', () => {
		const kill = vi.spyOn(process, 'kill').mockReturnValue(true)

		expect(run_wake_stop.stop(TARGET)).toBeUndefined()
		expect(kill).not.toHaveBeenCalled()
	})

	it('removes the record and signals a supervisor that is still running', () => {
		write_wake()
		vi.spyOn(run_wake, 'is_supervisor_live').mockReturnValue(true)
		const kill = vi.spyOn(process, 'kill').mockReturnValue(true)

		expect(run_wake_stop.stop(TARGET)?.pid).toBe(SUPERVISOR_PID)
		expect(kill).toHaveBeenCalledExactlyOnceWith(SUPERVISOR_PID, 'SIGTERM')
		expect(run_wake.read_wake(TARGET)).toBeUndefined()
	})

	it('removes the record of a supervisor already gone without signalling its pid', () => {
		write_wake()
		vi.spyOn(run_wake, 'is_supervisor_live').mockReturnValue(false)
		const kill = vi.spyOn(process, 'kill').mockReturnValue(true)

		expect(run_wake_stop.stop(TARGET)?.pid).toBe(SUPERVISOR_PID)
		expect(kill).not.toHaveBeenCalled()
		expect(run_wake.read_wake(TARGET)).toBeUndefined()
	})

	it('removes the record even when the supervisor cannot be signalled', () => {
		write_wake()
		vi.spyOn(run_wake, 'is_supervisor_live').mockReturnValue(true)
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
		vi.spyOn(process, 'kill').mockImplementation(() => {
			throw new Error('EPERM')
		})

		expect(run_wake_stop.stop(TARGET)?.pid).toBe(SUPERVISOR_PID)
		expect(run_wake.read_wake(TARGET)).toBeUndefined()
	})
})

describe('run_wake_stop.signal', () => {
	it('asks the process to end', () => {
		const kill = vi.spyOn(process, 'kill').mockReturnValue(true)

		run_wake_stop.signal(SUPERVISOR_PID)

		expect(kill).toHaveBeenCalledExactlyOnceWith(SUPERVISOR_PID, 'SIGTERM')
	})

	it('says so rather than throwing where the process cannot be signalled', () => {
		const said = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		vi.spyOn(process, 'kill').mockImplementation(() => {
			throw new Error('ESRCH')
		})

		expect(() => {
			run_wake_stop.signal(SUPERVISOR_PID)
		}).not.toThrow()
		expect(said).toHaveBeenCalledOnce()
	})
})
