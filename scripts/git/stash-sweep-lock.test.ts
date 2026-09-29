import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { stash_sweep_lock } from './stash-sweep-lock'

const scratch = mkdtempSync(path.join(tmpdir(), 'stash-sweep-lock-test-'))
const LOCK = path.join(scratch, 'lock.json')
const NO_WAIT_MS = 0
// A pid far above any real process table, so it reads as a process that is certainly gone.
const DEAD_PID = 2_147_483_000
const DONE = 'done'

async function work(): Promise<string> {
	return DONE
}

async function failing_work(): Promise<string> {
	throw new Error('boom')
}

beforeEach(() => {
	rmSync(LOCK, { force: true })
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

// joshuafolkken/kit#2701: two lane sweeps dropping by a resolved `stash@{n}` at once could drop the
// wrong entry, so the drop phase runs under one repository-wide lock.
describe('stash_sweep_lock.with_lock', () => {
	it('runs the work, answers its result and releases the lock', async () => {
		const result = await stash_sweep_lock.with_lock(work, LOCK, NO_WAIT_MS)

		expect(result).toBe(DONE)
		expect(existsSync(LOCK)).toBe(false)
	})

	it('does not run the work while a live process holds the lock', async () => {
		writeFileSync(LOCK, JSON.stringify({ pid: process.ppid }))
		const spy = vi.fn(work)

		const result = await stash_sweep_lock.with_lock(spy, LOCK, NO_WAIT_MS)

		expect(result).toBeUndefined()
		expect(spy).not.toHaveBeenCalled()
		expect(existsSync(LOCK)).toBe(true)
	})

	it('takes over a lock whose owner process is gone', async () => {
		writeFileSync(LOCK, JSON.stringify({ pid: DEAD_PID }))

		const result = await stash_sweep_lock.with_lock(work, LOCK, NO_WAIT_MS)

		expect(result).toBe(DONE)
		expect(existsSync(LOCK)).toBe(false)
	})

	it('releases the lock when the work throws', async () => {
		await expect(stash_sweep_lock.with_lock(failing_work, LOCK, NO_WAIT_MS)).rejects.toThrow('boom')
		expect(existsSync(LOCK)).toBe(false)
	})
})
