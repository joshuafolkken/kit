import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'

// A seat lock is a directory `mkdir` takes atomically; its owner file names the pid that took it, so a
// lock whose `lane:open` died before its cleanup ran is reclaimed by the next claim instead of failing
// that lane's every launch (joshuafolkken/kit#7651). A lock with no readable owner is still being
// written, or predates the owner file, so it stays held.
const OWNER_FILE = 'owner'

function owner_of(lock: string): number | undefined {
	try {
		const pid = Number(readFileSync(path.join(lock, OWNER_FILE), 'utf8').trim())

		return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
	} catch {
		return undefined
	}
}

function release(lock: string): void {
	rmSync(lock, { recursive: true, force: true })
}

function take(lock: string): boolean {
	try {
		mkdirSync(lock)
	} catch {
		return false
	}

	writeFileSync(path.join(lock, OWNER_FILE), String(process.pid))

	return true
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
// moved is still the dead owner's: two claimers reclaiming at once must not both take the lock.
function set_aside(lock: string, owner: number): boolean {
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
	if (owner === undefined || process_identity.is_present_pid(owner)) return false

	return set_aside(lock, owner) && take(lock)
}

const lane_seat_lock = { claim, release, OWNER_FILE }

export { lane_seat_lock }
