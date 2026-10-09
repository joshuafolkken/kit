import { randomUUID } from 'node:crypto'
import { linkSync, renameSync, rmSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { process_identity } from '#scripts/josh/process-identity'
import { process_owner_schema, type ProcessOwner } from '#scripts/josh/process-owner'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { git_common_directory } from './git-common-directory'

// One holder at a time per repository, for work that every work tree of that repository shares
// (the stash sweep, `git worktree add`). The
// record is keyed on the git common directory, so every work tree of one repository contends for one
// record per lock name, and it lives in the platform temp root beside the other stamps rather than
// inside `.git`. Each caller names its own lock with a prefix, so two unrelated kinds of work never
// wait on each other.

const POLL_INTERVAL_MS = 200
// The synchronous wait is for locks held for milliseconds, so it polls far more often.
const SYNC_POLL_INTERVAL_MS = 10
const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))

type IsGone = (owner: ProcessOwner) => boolean

// Without a `cwd` the read keeps the inherited git location variables, as every other git call of the
// running process does; an explicit `cwd` clears them so that directory is the one answered for.
function lock_path(prefix: string, cwd?: string): string {
	return stamp_file.stamp_path(prefix, git_common_directory.repository(cwd) ?? cwd ?? process.cwd())
}

// A record that is not JSON, or is JSON of any other shape — `null`, an array, an object with no
// numeric `pid` — is unreadable rather than an owner, so it is never judged and never cleared.
function parse_owner(raw: string | undefined): ProcessOwner | undefined {
	if (raw === undefined) return undefined

	const parsed = process_owner_schema.safeParse(json_value.parse_or_undefined(raw))

	return parsed.success ? parsed.data : undefined
}

function read_owner(target: string): ProcessOwner | undefined {
	return parse_owner(stamp_file.read_stamp_text(target))
}

function is_owner_gone(owner: ProcessOwner): boolean {
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

// The path the record was moved to, or `undefined` when another claimant moved it first.
function move_aside(target: string): string | undefined {
	const aside = `${target}.${String(process.pid)}.${randomUUID()}`

	try {
		renameSync(target, aside)

		return aside
	} catch {
		return undefined
	}
}

// A record whose process is certainly gone is a crashed holder's, and is cleared before the claim; an
// unreadable record or an uncertain answer is left in place, since clearing a live holder's lock is the
// very race the lock exists to close. **The clear is a rename, then a compare**: two claimants can
// both judge the same record stale, and the slower one's plain remove would delete the lock the faster
// one had just claimed. Renaming moves exactly one file aside atomically, and only a record
// byte-identical to the one judged stale is discarded — any other is a fresh claim and goes back.
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
		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		await sleep(POLL_INTERVAL_MS)
	}

	return true
}

// A blocking wait for a caller that cannot await. `Atomics.wait` parks the thread without spinning, so
// a writer queued behind another costs no CPU while it waits.
function sleep_sync(ms: number): void {
	Atomics.wait(SLEEP_CELL, 0, 0, ms)
}

function acquire_sync(target: string, max_wait_ms: number): boolean {
	const deadline = Date.now() + max_wait_ms

	while (!claim(target)) {
		if (Date.now() >= deadline) return false
		sleep_sync(SYNC_POLL_INTERVAL_MS)
	}

	return true
}

// Runs `work` holding the lock at `target` and answers its result, or `undefined` without running it
// when another holder kept the lock for the whole wait.
async function with_lock<T>(
	work: () => Promise<T>,
	target: string,
	max_wait_ms: number,
): Promise<T | undefined> {
	if (!(await acquire(target, max_wait_ms))) return undefined

	try {
		return await work()
	} finally {
		release(target)
	}
}

// `with_lock` for synchronous work — a read-modify-write that holds the lock for milliseconds, whose
// callers are synchronous all the way up.
function with_lock_sync<T>(work: () => T, target: string, max_wait_ms: number): T | undefined {
	if (!acquire_sync(target, max_wait_ms)) return undefined

	try {
		return work()
	} finally {
		release(target)
	}
}

const repository_lock = { clear_stale, lock_path, with_lock, with_lock_sync }

export { repository_lock }
