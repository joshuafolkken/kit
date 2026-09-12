import { copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { GATE_CACHE_FILES } from '#scripts/josh/josh-command-types'

// Warming a fresh lane's verification caches from the main checkout (joshuafolkken/kit#1849).
//
// `git worktree add` writes a checkout and nothing beside it, and the three caches the gate reads —
// `.eslintcache`, `.tsbuildinfo`, `.cspellcache` — are all git-ignored, so a new lane has none of
// them and only its *first* `josh gate` runs fully cold (measured at 353.9 s against 27.5 s warm,
// joshuafolkken/kit#1839). Warming that one run is the whole of this module.
//
// **A copy hits rather than missing, because all three caches are content-addressed.** eslint and
// cspell both run `--cache-strategy content` and tsc records its options inside the build-info file
// (`josh-command-types.ts`), so an entry is validated by the hash of the file it describes, never by
// that file's modification time — and `git worktree add` necessarily writes a fresh one. This is the
// same property that lets CI restore `.eslintcache` across runs on different machines
// (`.github/workflows/ci.yml` → "Setup ESLint cache"); a copy between work trees is the same move.
//
// **Each lane takes its own copy, never a shared file.** Two parallel lanes writing one
// `.eslintcache` would each rewrite it whole from the copy it loaded at start-up and discard the
// other's entries — the race `josh-command-types.ts` gives the edit hook and the scoped lint their
// own cache files to avoid. Independent copies are what make the warming safe under the lane fan-out.
//
// **Warming is best-effort: a lane with a cold cache is still a usable lane.** A cache the main
// checkout never produced is skipped, and a copy that fails is skipped rather than thrown — so
// seeding can never be the reason an open fails, unlike the `.env` write the lane cannot run without.

// Copy one cache file if the source has it. A source the main checkout lacks, or a copy that fails
// (a missing destination, a file removed mid-open), is skipped rather than thrown: warming must
// never fail the open.
function copy_if_present(source_root: string, destination: string, cache_file: string): void {
	if (!existsSync(path.join(source_root, cache_file))) return

	try {
		copyFileSync(path.join(source_root, cache_file), path.join(destination, cache_file))
	} catch {
		// Best-effort: a lane whose cache could not be copied simply runs its first gate cold.
	}
}

/**
 * Copy the gate's verification caches from `source_root` into `destination`, skipping any the
 * source does not have. Warming is best-effort and never throws.
 */
function seed_caches(source_root: string, destination: string): void {
	for (const cache_file of GATE_CACHE_FILES) {
		copy_if_present(source_root, destination, cache_file)
	}
}

const lane_cache = { seed_caches }

export { lane_cache }
