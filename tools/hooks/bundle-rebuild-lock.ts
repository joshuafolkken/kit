import { rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// The lock that keeps the launches finding a bundle directory stale at once to one rebuild — shared by
// the hook launcher (`tools/hooks/hook-bundle-ready.ts`) and josh's (`tools/josh/josh-ready.ts`).
// Loaded by plain `node` on every launch, so it imports `node:` built-ins alone.

// A rebuild takes seconds, so a lock this old was left by a build that died.
const ABANDONED_LOCK_MS = 60_000

// Beside the bundles, not among them: a build prunes every file in its directory it did not emit.
function beside_bundles(out_directory: string, suffix: string): string {
	return path.join(path.dirname(out_directory), `.${path.basename(out_directory)}-${suffix}`)
}

function lock_path(out_directory: string): string {
	return beside_bundles(out_directory, 'rebuild.lock')
}

function is_free(lock: string): boolean {
	const stats = statSync(lock, { throwIfNoEntry: false })

	return stats === undefined || Date.now() - stats.mtimeMs > ABANDONED_LOCK_MS
}

// An exclusive create, so of the launches that find the bundles stale at once only one starts a build.
function claim(lock: string): boolean {
	if (!is_free(lock)) return false
	rmSync(lock, { force: true })

	try {
		writeFileSync(lock, '', { flag: 'wx' })

		return true
	} catch {
		return false
	}
}

function release(lock: string): void {
	rmSync(lock, { force: true })
}

const bundle_rebuild_lock = {
	ABANDONED_LOCK_MS,
	beside_bundles,
	claim,
	is_free,
	lock_path,
	release,
}

export { bundle_rebuild_lock }
