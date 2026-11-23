import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'

// At most one `josh gate` per worktree at a time (joshuafolkken/kit#8846).
//
// The core / memory admission ledger budgets the whole machine, so nothing stopped a second gate on
// the same tree: two gates there run the same ESLint scan and type program side by side, fight over
// memory, and neither finishes in its usual time. The lock is keyed on the checkout root, so gates in
// other worktrees (other lanes, main) never wait on each other.
//
// **Created with `wx`, so two gates starting together cannot both take it.** A lock whose writer is
// gone — a gate that was killed never reaches its `finally` — is stolen; the writer is the pair (pid,
// start time), so a reissued pid does not keep a dead gate's lock alive. A writer whose start time
// cannot be read counts as live: refusing costs one re-run, a second gate costs the machine.
const LOCK_PREFIX = 'josh-gate-lock-'
const CREATE_FLAG = 'wx'
const LOCK_FILE_MODE = 0o600
const ALREADY_EXISTS = 'EEXIST'
const REFUSED_EXIT_CODE = 1

interface LockOwner {
	pid: number
	process_start?: string
}

interface LockOptions {
	target?: string
	is_alive?: (owner: LockOwner) => boolean
	report?: (line: string) => void
}

function lock_path(root: string = PROJECT_ROOT): string {
	return stamp_file.stamp_path(LOCK_PREFIX, root)
}

function is_owner_alive(owner: LockOwner): boolean {
	return process_identity.is_same_process(owner.pid, owner.process_start) !== false
}

function is_lock_owner(value: unknown): value is LockOwner {
	return (
		typeof value === 'object' && value !== null && 'pid' in value && typeof value.pid === 'number'
	)
}

function read_owner(target: string): LockOwner | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(target, 'utf8'))

		return is_lock_owner(parsed) ? parsed : undefined
	} catch {
		return undefined
	}
}

function try_create(target: string): boolean {
	try {
		writeFileSync(target, JSON.stringify(process_identity.own_fields()), {
			flag: CREATE_FLAG,
			mode: LOCK_FILE_MODE,
		})

		return true
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === ALREADY_EXISTS) return false
		throw error
	}
}

// A gate that lost the race for a stolen lock names whoever won it; `0` when that lock is unreadable.
function steal(target: string): LockOwner | undefined {
	rmSync(target, { force: true })
	if (try_create(target)) return undefined

	return read_owner(target) ?? { pid: 0 }
}

// The live owner holding the lock, or `undefined` once this process holds it.
function acquire(target: string, is_alive: (owner: LockOwner) => boolean): LockOwner | undefined {
	if (try_create(target)) return undefined
	const owner = read_owner(target)

	return owner !== undefined && is_alive(owner) ? owner : steal(target)
}

// Removes the lock only while it is still this process's own, so a gate whose lock was stolen never
// deletes the thief's.
function release(target: string): void {
	const owner = read_owner(target)

	if (owner !== undefined && process_identity.is_own_process(owner.pid, owner.process_start)) {
		rmSync(target, { force: true })
	}
}

const DEFAULT_OPTIONS: Required<LockOptions> = {
	target: lock_path(),
	is_alive: is_owner_alive,
	report: console.error,
}

function refusal(owner: LockOwner): string {
	return (
		`josh gate: another gate is already running in this worktree (pid ${String(owner.pid)}); ` +
		'not starting a second one. Wait for it to finish, or stop that process.'
	)
}

async function run_locked(run: () => Promise<number>, options: LockOptions = {}): Promise<number> {
	const { target, is_alive, report } = { ...DEFAULT_OPTIONS, ...options }
	const owner = acquire(target, is_alive)

	if (owner !== undefined) {
		report(refusal(owner))

		return REFUSED_EXIT_CODE
	}

	try {
		return await run()
	} finally {
		release(target)
	}
}

const gate_worktree_lock = {
	REFUSED_EXIT_CODE,
	lock_path,
	run_locked,
}

export { gate_worktree_lock }
export type { LockOwner }
