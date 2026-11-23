import { linkSync, renameSync } from 'node:fs'
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
// gone — a gate that was killed never reaches its `finally` — is stolen through an atomic rename
// (`set_aside`); the writer is the pair (pid,
// start time), so a reissued pid does not keep a dead gate's lock alive. A writer whose start time
// cannot be read counts as live: refusing costs one re-run, a second gate costs the machine.
const LOCK_PREFIX = 'josh-gate-lock-'
const ASIDE_SUFFIX = '.stale'
const REFUSED_EXIT_CODE = 1
const UNKNOWN_OWNER = { pid: 0 }

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

function parse_json(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		return undefined
	}
}

function parse_owner(text: string | undefined): LockOwner | undefined {
	if (text === undefined) return undefined
	const parsed = parse_json(text)

	return is_lock_owner(parsed) ? parsed : undefined
}

// Read through `read_stamp_text`, so a file another account planted at the shared path reads as no
// owner rather than one this gate must wait on.
function read_owner(target: string): LockOwner | undefined {
	return parse_owner(stamp_file.read_stamp_text(target))
}

function try_create(target: string): boolean {
	return stamp_file.create_stamp(target, process_identity.own_fields())
}

// The rename is atomic, so of two gates that judged the same dead lock only one moves it. A gate
// that finds it moved a lock other than the one it judged — another gate already replaced it — links
// it back; `linkSync` fails rather than overwrites when a third gate has taken the path meanwhile.
function set_aside(target: string, judged: string | undefined): void {
	const aside = `${target}.${String(process.pid)}${ASIDE_SUFFIX}`

	try {
		renameSync(target, aside)
		if (stamp_file.read_stamp_text(aside) !== judged) linkSync(aside, target)
	} catch {
		// The lock already moved, or its path is taken again: either way the create below decides.
	}

	stamp_file.remove_stamp(aside)
}

// A gate that lost the race for a stolen lock names whoever won it; `0` when that lock is unreadable.
function take_over(target: string, judged: string | undefined): LockOwner | undefined {
	set_aside(target, judged)
	if (try_create(target)) return undefined

	return read_owner(target) ?? UNKNOWN_OWNER
}

// The live owner holding the lock, or `undefined` once this process holds it.
function acquire(target: string, is_alive: (owner: LockOwner) => boolean): LockOwner | undefined {
	if (try_create(target)) return undefined
	const judged = stamp_file.read_stamp_text(target)
	const owner = parse_owner(judged)

	return owner !== undefined && is_alive(owner) ? owner : take_over(target, judged)
}

// Removes the lock only while it is still this process's own, so a gate whose lock was stolen never
// deletes the thief's.
function release(target: string): void {
	const owner = read_owner(target)

	if (owner !== undefined && process_identity.is_own_process(owner.pid, owner.process_start)) {
		stamp_file.remove_stamp(target)
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
