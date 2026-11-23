import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
import { gate_worktree_lock } from './gate-worktree-lock'

const GATE_EXIT_CODE = 7
const GATE_ERROR = 'gate failed'
const LANE_A = '/work/lane-a'
const create_directory = temporary_directory()

function lock_in(name: string): string {
	return path.join(create_directory('gate-worktree-lock-'), `${name}.json`)
}

// The live owner is this test process itself, read back through the real (pid, start time) check.
function write_live_lock(target: string): void {
	writeFileSync(target, JSON.stringify(process_identity.own_fields()))
}

// A live pid paired with a start time it never had: the record a reissued pid leaves behind.
function write_dead_lock(target: string): void {
	writeFileSync(target, JSON.stringify({ pid: process.pid, process_start: 'not-this-process' }))
}

describe('gate_worktree_lock.run_locked — a held lock', () => {
	it('refuses a second gate while a live gate holds the lock, naming its pid', async () => {
		const target = lock_in('held')
		const run = vi.fn(async () => 0)
		const report = vi.fn()

		write_live_lock(target)

		const code = await gate_worktree_lock.run_locked(run, { target, report })

		expect(code).toBe(gate_worktree_lock.REFUSED_EXIT_CODE)
		expect(run).not.toHaveBeenCalled()
		expect(report).toHaveBeenCalledWith(expect.stringContaining(`pid ${String(process.pid)}`))
		expect(existsSync(target)).toBe(true)
	})

	it('takes over a lock whose owner is gone and runs the gate', async () => {
		const target = lock_in('stale')
		const run = vi.fn(async () => await GATE_EXIT_CODE)

		write_dead_lock(target)

		const code = await gate_worktree_lock.run_locked(run, { target, report: vi.fn() })

		expect(code).toBe(GATE_EXIT_CODE)
		expect(run).toHaveBeenCalledOnce()
		expect(existsSync(target)).toBe(false)
	})

	it('does not stop a gate in another worktree', async () => {
		const held = lock_in('other-worktree')
		const target = lock_in('this-worktree')
		const run = vi.fn(async () => 0)

		write_live_lock(held)

		expect(await gate_worktree_lock.run_locked(run, { target })).toBe(0)
		expect(run).toHaveBeenCalledOnce()
	})
})

describe('gate_worktree_lock.run_locked — the own lock', () => {
	it('holds the lock while the gate runs and releases it after a throw', async () => {
		const target = lock_in('own')
		const seen: Array<string> = []
		const run = vi.fn(async () => {
			seen.push(readFileSync(target, 'utf8'))
			throw new Error(GATE_ERROR)
		})

		await expect(gate_worktree_lock.run_locked(run, { target })).rejects.toThrow(GATE_ERROR)
		expect(JSON.parse(seen[0] ?? '{}')).toMatchObject({ pid: process.pid })
		expect(existsSync(target)).toBe(false)
	})
})

describe('gate_worktree_lock.lock_path', () => {
	it('keys the lock on the checkout root', () => {
		const first = gate_worktree_lock.lock_path(LANE_A)

		expect(first).not.toBe(gate_worktree_lock.lock_path('/work/lane-b'))
		expect(first).toBe(gate_worktree_lock.lock_path(LANE_A))
	})
})
