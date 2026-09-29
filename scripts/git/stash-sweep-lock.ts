import { setTimeout as sleep } from 'node:timers/promises'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { git_common_directory } from './git-common-directory'

// One stash sweep at a time per repository (joshuafolkken/kit#2701). The stash is a single stack every
// work tree shares, and a `backlogrun` runs one sweep per lane seat at once: two sweeps that each
// resolve the same entry to `stash@{n}` and drop it would have the second drop land on whichever entry
// moved into that position, and two that carry the same ledger lines would both append them. The lock
// is keyed on the git common directory, so every work tree of one repository contends for one record.

const LOCK_PREFIX = 'josh-stash-sweep-lock-'
// The locked phase is local git and one file append per entry, so a holder finishes in well under the
// wait; the cap only bounds a holder that hung, and a sweep that gives up keeps its entries.
const POLL_INTERVAL_MS = 200
const MAX_WAIT_MS = 30_000

interface LockOwner {
	pid: number
	process_start?: string
}

function lock_path(cwd: string = process.cwd()): string {
	return stamp_file.stamp_path(LOCK_PREFIX, git_common_directory.repository(cwd) ?? cwd)
}

function read_owner(target: string): LockOwner | undefined {
	const raw = stamp_file.read_stamp_text(target)

	if (raw === undefined) return undefined

	try {
		return JSON.parse(raw) as LockOwner
	} catch {
		return undefined
	}
}

// A record whose process is certainly gone is a crashed sweep's, and is cleared before the claim; an
// unreadable record or an uncertain answer is left in place, since clearing a live holder's lock is the
// very race the lock exists to close.
function clear_stale(target: string): void {
	const owner = read_owner(target)

	if (
		owner === undefined ||
		process_identity.is_same_process(owner.pid, owner.process_start) !== false
	) {
		return
	}

	stamp_file.remove_stamp(target)
}

function claim(target: string): boolean {
	clear_stale(target)

	return stamp_file.create_stamp(target, process_identity.own_fields())
}

function release(target: string): void {
	const owner = read_owner(target)

	if (owner !== undefined && process_identity.is_own_process(owner.pid, owner.process_start)) {
		stamp_file.remove_stamp(target)
	}
}

async function acquire(target: string, max_wait_ms: number): Promise<boolean> {
	const deadline = Date.now() + max_wait_ms

	while (!claim(target)) {
		if (Date.now() >= deadline) return false
		await sleep(POLL_INTERVAL_MS)
	}

	return true
}

// Runs `work` holding the lock and answers its result, or `undefined` without running it when another
// sweep held the lock for the whole wait.
async function with_lock<T>(
	work: () => Promise<T>,
	target: string = lock_path(),
	max_wait_ms: number = MAX_WAIT_MS,
): Promise<T | undefined> {
	if (!(await acquire(target, max_wait_ms))) return undefined

	try {
		return await work()
	} finally {
		release(target)
	}
}

const stash_sweep_lock = { lock_path, with_lock }

export { stash_sweep_lock }
