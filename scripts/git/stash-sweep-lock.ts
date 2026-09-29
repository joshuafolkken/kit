import { randomUUID } from 'node:crypto'
import { linkSync, renameSync, rmSync } from 'node:fs'
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

type IsGone = (owner: LockOwner) => boolean

function parse_owner(raw: string | undefined): LockOwner | undefined {
	if (raw === undefined) return undefined

	try {
		return JSON.parse(raw) as LockOwner
	} catch {
		return undefined
	}
}

function read_owner(target: string): LockOwner | undefined {
	return parse_owner(stamp_file.read_stamp_text(target))
}

function is_owner_gone(owner: LockOwner): boolean {
	return process_identity.is_same_process(owner.pid, owner.process_start) === false
}

// Put back a record that turned out not to be the stale one. `linkSync` refuses an existing path, so
// a lock someone claimed in the meantime is never overwritten.
function restore(aside: string, target: string): void {
	try {
		linkSync(aside, target)
	} catch {
		// Another claim already holds the path; the record set aside is dropped below.
	}
}

// The record's text when its owner is certainly gone, else `undefined`.
function stale_record(target: string, is_gone: IsGone): string | undefined {
	const raw = stamp_file.read_stamp_text(target)
	const owner = parse_owner(raw)

	return owner !== undefined && is_gone(owner) ? raw : undefined
}

// The path the record was moved to, or `undefined` when another sweep moved it first.
function move_aside(target: string): string | undefined {
	const aside = `${target}.${String(process.pid)}.${randomUUID()}`

	try {
		renameSync(target, aside)

		return aside
	} catch {
		return undefined
	}
}

// A record whose process is certainly gone is a crashed sweep's, and is cleared before the claim; an
// unreadable record or an uncertain answer is left in place, since clearing a live holder's lock is the
// very race the lock exists to close. **The clear is a rename, then a compare**: two sweeps can both
// judge the same record stale, and the slower one's plain remove would delete the lock the faster one
// had just claimed. Renaming moves exactly one file aside atomically, and only a record byte-identical
// to the one judged stale is discarded — any other is a fresh claim and goes back.
function clear_stale(target: string, is_gone: IsGone = is_owner_gone): void {
	const raw = stale_record(target, is_gone)

	if (raw === undefined) return

	const aside = move_aside(target)

	if (aside === undefined) return
	if (stamp_file.read_stamp_text(aside) !== raw) restore(aside, target)
	rmSync(aside, { force: true })
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

const stash_sweep_lock = { clear_stale, lock_path, with_lock }

export { stash_sweep_lock }
