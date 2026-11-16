import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'

// A seat lock is a directory `mkdir` takes atomically; its owner file names the pid that took it, so a
// lock whose `lane:open` died before its cleanup ran is reclaimed by the next claim instead of failing
// that lane's every launch (joshuafolkken/kit#7651). A lock with no readable owner is being written
// for a moment after its `mkdir`; one still ownerless past the grace was left by a claimer that died
// in between, or by a `lane:open` from before the owner file, and is abandoned too.
const OWNER_FILE = 'owner'
const OWNERLESS_GRACE_MS = 60_000

function owner_of(lock: string): number | undefined {
	try {
		const pid = Number(readFileSync(path.join(lock, OWNER_FILE), 'utf8').trim())

		return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
	} catch {
		return undefined
	}
}

function age_ms(lock: string): number {
	try {
		return Date.now() - statSync(lock).mtimeMs
	} catch {
		return 0
	}
}

function is_abandoned_by(lock: string, owner: number | undefined): boolean {
	if (owner === undefined) return age_ms(lock) > OWNERLESS_GRACE_MS

	return !process_identity.is_present_pid(owner)
}

function is_abandoned(lock: string): boolean {
	return is_abandoned_by(lock, owner_of(lock))
}

function release(lock: string): void {
	rmSync(lock, { recursive: true, force: true })
}

// The owner write fails when another claimer set the fresh lock aside in between; it is not ours then.
function take(lock: string): boolean {
	try {
		mkdirSync(lock)
		writeFileSync(path.join(lock, OWNER_FILE), String(process.pid))

		return true
	} catch {
		return false
	}
}

// Puts a lock back after a set-aside caught another claimer's fresh lock instead of the abandoned one.
// A third claimer that took the name meanwhile owns it now, so the caught lock is dropped instead.
function restore(aside: string, lock: string): void {
	try {
		renameSync(aside, lock)
	} catch {
		release(aside)
	}
}

// Moves the abandoned lock out of the way under a name only this process uses, then checks that what
// moved is still the abandoned owner's: two claimers reclaiming at once must not both take the lock.
function set_aside(lock: string, owner: number | undefined): boolean {
	const aside = `${lock}.abandoned-${String(process.pid)}`

	try {
		renameSync(lock, aside)
	} catch {
		return false
	}

	if (owner_of(aside) === owner) {
		release(aside)

		return true
	}

	restore(aside, lock)

	return false
}

function claim(lock: string): boolean {
	mkdirSync(path.dirname(lock), { recursive: true })
	if (take(lock)) return true
	const owner = owner_of(lock)
	if (!is_abandoned_by(lock, owner)) return false

	return set_aside(lock, owner) && take(lock)
}

const lane_seat_lock = { claim, is_abandoned, release, OWNER_FILE }

export { lane_seat_lock }
