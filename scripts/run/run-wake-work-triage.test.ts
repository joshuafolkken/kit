import { josh_command } from '#scripts/josh/josh-run'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_wake_work } from './run-wake-work'

// joshuafolkken/kit#2779: `backlog:next` answering `triage` offers no number, but a session has work —
// judging the untriaged issues — so the idle supervisor wakes one rather than letting the pool idle.

const TRIAGE_WORK = 1
const NO_WORK = 0
const READY_TWO = 2

function answering(out: string, code = 0): void {
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code, out })
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_wake_work.DEFAULT_WORK_PORTS.ready_count', () => {
	it('counts a triage answer as work', async () => {
		answering('triage')

		await expect(run_wake_work.DEFAULT_WORK_PORTS.ready_count()).resolves.toBe(TRIAGE_WORK)
	})

	it('counts the runnable numbers as before', async () => {
		answering('2445\n2446')

		await expect(run_wake_work.DEFAULT_WORK_PORTS.ready_count()).resolves.toBe(READY_TWO)
	})

	it('counts a wait answer as no work', async () => {
		answering('wait')

		await expect(run_wake_work.DEFAULT_WORK_PORTS.ready_count()).resolves.toBe(NO_WORK)
	})
})
