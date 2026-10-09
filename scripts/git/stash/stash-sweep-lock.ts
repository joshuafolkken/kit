import { repository_lock } from '#scripts/git/repository-lock'

// One stash sweep at a time per repository. The stash is a single stack every
// work tree shares, and a `backlogrun` runs one sweep per lane seat at once: two sweeps that each
// resolve the same entry to `stash@{n}` and drop it would have the second drop land on whichever entry
// moved into that position, and two that carry the same ledger lines would both append them. The
// locking itself is `repository-lock.ts`, shared with the work-tree writes.

const LOCK_PREFIX = 'josh-stash-sweep-lock-'
// The locked phase is local git and one file append per entry, so a holder finishes in well under the
// wait; the cap only bounds a holder that hung, and a sweep that gives up keeps its entries.
const MAX_WAIT_MS = 30_000

function lock_path(cwd?: string): string {
	return repository_lock.lock_path(LOCK_PREFIX, cwd)
}

// Runs `work` holding the lock and answers its result, or `undefined` without running it when another
// sweep held the lock for the whole wait.
async function with_lock<T>(
	work: () => Promise<T>,
	target: string = lock_path(),
	max_wait_ms: number = MAX_WAIT_MS,
): Promise<T | undefined> {
	return await repository_lock.with_lock(work, target, max_wait_ms)
}

const stash_sweep_lock = { clear_stale: repository_lock.clear_stale, with_lock }

export { stash_sweep_lock }
