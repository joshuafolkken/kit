import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_install } from '#scripts/lane/lane-install'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCKFILE_NAME, lockfile_sync, RECORD_PATH } from './lockfile-sync'

// joshuafolkken/kit#3463: a pull that changed the lock left the primary checkout's `node_modules`
// behind it. What is pinned is the trigger — the lock against the one last installed — so the directory
// is a real temp tree and the install itself (pinned in `lane-install.test.ts`) is mocked.

vi.mock('#scripts/lane/lane-install', () => ({
	lane_install: { install_dependencies: vi.fn() },
}))

const install = vi.mocked(lane_install.install_dependencies)

const LOCK_BEFORE = "lockfileVersion: '9.0'\n"
const LOCK_AFTER = "lockfileVersion: '9.0'\npackages:\n  cli-spinners@3.2.0: {}\n"
const INSTALL_OUTPUT = 'Done in 3.4s'
const INSTALL_FAILURE = { is_installed: false, output: 'ERR_PNPM_FETCH_404' }

const checkout = { directory: '' }

function write_lock(content: string): void {
	writeFileSync(path.join(checkout.directory, LOCKFILE_NAME), content)
}

function read_record(): string {
	return readFileSync(path.join(checkout.directory, RECORD_PATH), 'utf8')
}

// A checkout whose last successful install recorded `content`, then had `content` checked out again.
async function installed(content: string): Promise<void> {
	write_lock(content)
	await lockfile_sync.reinstall_if_stale(checkout.directory)
	install.mockClear()
}

beforeEach(() => {
	vi.clearAllMocks()
	checkout.directory = mkdtempSync(path.join(tmpdir(), 'lockfile-sync-'))
	install.mockResolvedValue({ is_installed: true, output: INSTALL_OUTPUT })
})

afterEach(() => {
	rmSync(checkout.directory, { recursive: true, force: true })
})

describe('reinstalling a stale checkout', () => {
	it('installs in the directory when the lock differs from the one last installed', async () => {
		await installed(LOCK_BEFORE)
		write_lock(LOCK_AFTER)

		const result = await lockfile_sync.reinstall_if_stale(checkout.directory)

		expect(install).toHaveBeenCalledWith(checkout.directory)
		expect(result).toStrictEqual({ is_installed: true, output: INSTALL_OUTPUT })
	})

	it('spawns no install when the lock is the one last installed', async () => {
		await installed(LOCK_BEFORE)

		const result = await lockfile_sync.reinstall_if_stale(checkout.directory)

		expect(install).not.toHaveBeenCalled()
		expect(result.is_installed).toBe(true)
	})

	it('spawns no install when the checkout has no lock', async () => {
		await lockfile_sync.reinstall_if_stale(checkout.directory)

		expect(install).not.toHaveBeenCalled()
	})

	it('installs once on a checkout with no record yet, and records it', async () => {
		mkdirSync(path.join(checkout.directory, 'node_modules'))
		write_lock(LOCK_AFTER)

		await lockfile_sync.reinstall_if_stale(checkout.directory)
		await lockfile_sync.reinstall_if_stale(checkout.directory)

		expect(install).toHaveBeenCalledOnce()
		expect(read_record()).not.toBe('')
	})
})

// The review finding that shaped this: a trigger relative to the sync forgot a failed install, so the
// natural retry saw an unchanged lock and exited 0 over a stale `node_modules`.
describe('a failed install', () => {
	it('passes the failure through', async () => {
		write_lock(LOCK_AFTER)
		install.mockResolvedValue(INSTALL_FAILURE)

		const result = await lockfile_sync.reinstall_if_stale(checkout.directory)

		expect(result.is_installed).toBe(false)
	})

	it('is retried by the next call rather than forgotten', async () => {
		await installed(LOCK_BEFORE)
		write_lock(LOCK_AFTER)
		install.mockResolvedValueOnce(INSTALL_FAILURE)

		await lockfile_sync.reinstall_if_stale(checkout.directory)
		const retry = await lockfile_sync.reinstall_if_stale(checkout.directory)

		expect(install).toHaveBeenCalledTimes(2)
		expect(retry.is_installed).toBe(true)
	})
})
