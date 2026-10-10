import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { lane_install } from '#scripts/lane/lane-install'

// Keeping the primary checkout's `node_modules` in step with its lock. A
// fast-forward that brought in a merge adding `cli-spinners` left the primary checkout without it, and
// every `josh` typed there — the supervisor's driver included — failed with `ERR_MODULE_NOT_FOUND`
// until someone ran the install by hand.
//
// **The trigger is the lock differing from the one last installed, not the sync itself.** Most syncs
// pull no dependency change, and an install on every one would cost seconds per child for nothing. The
// comparison is against a record written after a successful install rather than against the lock read
// before the sync: a sync-relative trigger forgets a failed install, so the retry saw an unchanged lock
// and left `node_modules` stale, where this one keeps asking until an install succeeds. The record lives
// inside `node_modules`, so deleting the directory forgets it too. The install is `lane_install`'s, so
// `--frozen-lockfile`, the buffered output and the timeout stay single-sourced with the lane's own fill.

const LOCKFILE_NAME = 'pnpm-lock.yaml'
const RECORD_PATH = path.join('node_modules', '.josh-installed-lock')

const UP_TO_DATE = { is_installed: true, output: '' }

interface LockfileSyncResult {
	is_installed: boolean
	output: string
}

function read_text(file_path: string): string | undefined {
	return existsSync(file_path) ? readFileSync(file_path, 'utf8') : undefined
}

function digest(content: string): string {
	return createHash('sha256').update(content).digest('hex')
}

function record(directory: string, lock_digest: string): void {
	const record_path = path.join(directory, RECORD_PATH)

	mkdirSync(path.dirname(record_path), { recursive: true })
	writeFileSync(record_path, lock_digest)
}

/**
 * Reinstall when the lock in `directory` differs from the one the last successful install recorded.
 * A checkout with no lock, or one already installed, spawns nothing and reports installed.
 */
async function reinstall_if_stale(directory: string): Promise<LockfileSyncResult> {
	const lock = read_text(path.join(directory, LOCKFILE_NAME))

	if (lock === undefined) return UP_TO_DATE
	const lock_digest = digest(lock)

	if (read_text(path.join(directory, RECORD_PATH)) === lock_digest) return UP_TO_DATE
	const result = await lane_install.install_dependencies(directory)

	if (result.is_installed) record(directory, lock_digest)

	return result
}

const lockfile_sync = { reinstall_if_stale }

export type { LockfileSyncResult }
export { lockfile_sync, LOCKFILE_NAME, RECORD_PATH }
