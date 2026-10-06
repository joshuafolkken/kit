import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { process_identity } from '#scripts/josh/process-identity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { josh_harness, type CommandOptions, type JoshEnvironment } from './josh-harness'
import { unit_worker_share } from './unit-worker-share'

// The scenarios that open an environment live in the `josh-harness-*.test.ts` files beside this one,
// one per set of environments, so they run in parallel (joshuafolkken/kit#3083).

const SETUP_FAILED = 'setup failed'
const NEVER_ENDS_MS = 30_000
const TIMER_MS = 200
const HARNESS_TIMEOUT_MS = 500
const EXIT_WAIT_MS = 5000
// A shell that starts a grandchild, records its pid, and waits on it — the shape of a gate whose
// checks outlive a killed `pnpm`.
const PID_FILE = 'grandchild.pid'
const SPAWNS_GRANDCHILD = ['-c', `sleep 30 & echo $! > ${PID_FILE}; wait`]

const scratch = { directory: '' }

beforeEach(() => {
	scratch.directory = mkdtempSync(path.join(tmpdir(), 'josh-harness-unit-'))
})

afterEach(() => {
	josh_harness.stop_all()
	vi.unstubAllEnvs()
	rmSync(scratch.directory, { recursive: true, force: true })
})

function options(timeout_ms: number): CommandOptions {
	return { cwd: scratch.directory, env: {}, timeout_ms }
}

function pid_file(): string {
	return path.join(scratch.directory, PID_FILE)
}

async function grandchild_pid(): Promise<number> {
	expect(await josh_harness.wait_for(() => existsSync(pid_file()), EXIT_WAIT_MS)).toBe(true)

	return Number(readFileSync(pid_file(), 'utf8').trim())
}

async function settled_as(label: string, pending: Promise<unknown>): Promise<string> {
	await pending

	return label
}

async function has_died(pid: number): Promise<boolean> {
	return await josh_harness.wait_for(() => !process_identity.is_live_pid(pid), EXIT_WAIT_MS)
}

describe('josh harness — a setup that fails', () => {
	it('removes its workspace and rethrows the error', async () => {
		const seen: Array<string> = []
		const failing = josh_harness.in_workspace((workspace) => {
			seen.push(workspace)
			throw new Error(SETUP_FAILED)
		})

		await expect(failing).rejects.toThrow(SETUP_FAILED)
		expect(seen).toHaveLength(1)
		expect(existsSync(seen[0] ?? '')).toBe(false)
	})
})

describe('josh harness — a child that does not finish (#3309)', () => {
	it('keeps the event loop free while it waits, so a vitest timeout can fire', async () => {
		const pending = josh_harness.run_command('sleep', ['30'], options(NEVER_ENDS_MS))
		const first = await Promise.race([settled_as('child', pending), sleep(TIMER_MS, 'timer')])
		const stopped = josh_harness.stop_all()

		await pending
		expect(first).toBe('timer')
		expect(stopped).toHaveLength(1)
		expect(stopped[0]).toMatch(/^sleep 30 \(pid \d+, running \d+\.\d s\)$/u)
	})

	it('kills the grandchild along with the child when the harness timeout fires', async () => {
		const result = await josh_harness.run_command(
			'sh',
			SPAWNS_GRANDCHILD,
			options(HARNESS_TIMEOUT_MS),
		)

		expect(result.is_timed_out).toBe(true)
		expect(await has_died(await grandchild_pid())).toBe(true)
		expect(josh_harness.stop_all()).toStrictEqual([])
	})

	it('kills the grandchild along with the child when the test stops every child', async () => {
		const pending = josh_harness.run_command('sh', SPAWNS_GRANDCHILD, options(NEVER_ENDS_MS))
		const grandchild = await grandchild_pid()

		expect(josh_harness.stop_all()).toHaveLength(1)
		await pending
		expect(await has_died(grandchild)).toBe(true)
	})
})

describe('josh harness — the environment a child starts in (#3309)', () => {
	it('marks every child as a nested run, so a gate it starts reserves no cores', async () => {
		const environment: JoshEnvironment = {
			kind: 'kit',
			root: scratch.directory,
			primary: scratch.directory,
			workspace: scratch.directory,
			launcher: {
				executable: process.execPath,
				leading_arguments: [
					'-e',
					`process.stdout.write(process.env['${unit_worker_share.NESTED_KEY}'] ?? '')`,
				],
			},
		}

		// Cleared here, since `josh test:unit` marks its own workers and the child would inherit that mark.
		vi.stubEnv(unit_worker_share.NESTED_KEY, '')
		const result = await josh_harness.run(environment, [])

		expect(result.stdout).toBe(unit_worker_share.NESTED_VALUE)
	})
})
