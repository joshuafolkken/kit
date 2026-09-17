import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
	GATE_CACHE_SPECS,
	SHARED_CACHE_SPECS,
	type GateCacheSpec,
} from '#scripts/josh/josh-command-types'

// Warming a fresh lane's verification caches from the main checkout (joshuafolkken/kit#1849).
//
// `git worktree add` writes a checkout and nothing beside it, and the three caches the gate reads —
// `.eslintcache`, `.tsbuildinfo`, `.cspellcache` — are all git-ignored, so a new lane has none of
// them and only its *first* `josh gate` runs fully cold (measured at 353.9 s against 27.5 s warm,
// joshuafolkken/kit#1839). The initial seed warms that run; the per-tool sync below keeps the
// portable ESLint and CSpell caches current afterwards (#2060).
//
// Content hashes make stale entries safe, but do not by themselves make a cache portable (#2060).
// ESLint keys entries by absolute file path, so its JSON is rebased while cspell's relative keys and
// TypeScript's build info move raw. The spec in `josh-command-types.ts` is the one declaration of
// which treatment and which continuous sharing each gate cache receives.
//
// **Each tool runs against its lane's own file, never a shared live file.** A completed tool then
// atomically publishes its whole cache to main; when lanes overlap, the last completion wins as an
// intentional best-effort policy. ESLint and CSpell keep separate files and separate life cycles, so
// one tool finishing cannot publish the other's in-progress state.
//
// **Warming is best-effort: a lane with a cold cache is still a usable lane.** A cache the main
// checkout never produced is skipped, and a copy that fails is skipped rather than thrown — so
// seeding can never be the reason an open fails, unlike the `.env` write the lane cannot run without.

function replace_root(value: unknown, source_prefix: string, destination_root: string): unknown {
	if (typeof value !== 'string') return value

	if (!value.startsWith(source_prefix)) return value

	return path.join(destination_root, value.slice(source_prefix.length))
}

function rebase_json(content: string, source_root: string, destination_root: string): string {
	const parsed: unknown = JSON.parse(content)
	const source_prefix = `${path.resolve(source_root)}${path.sep}`
	const resolved_destination = path.resolve(destination_root)

	return JSON.stringify(parsed, function replace_path(_key: string, value: unknown): unknown {
		return replace_root(value, source_prefix, resolved_destination)
	})
}

function portable_content(
	content: string,
	spec: GateCacheSpec,
	source_root: string,
	destination_root: string,
): string {
	if (spec.portability === 'rooted-json') return rebase_json(content, source_root, destination_root)

	JSON.parse(content)

	return content
}

function write_atomically(destination_path: string, content: string): void {
	const temporary_path = `${destination_path}.${String(process.pid)}.${randomUUID()}.tmp`

	try {
		writeFileSync(temporary_path, content, { flag: 'wx' })
		renameSync(temporary_path, destination_path)
	} catch {
		// Best-effort: a cache that could not be published simply leaves the destination unchanged.
	} finally {
		rmSync(temporary_path, { force: true })
	}
}

function copy_if_present(source_root: string, destination: string, spec: GateCacheSpec): void {
	const source_path = path.join(source_root, spec.cache_file)
	if (!existsSync(source_path)) return

	try {
		const content = portable_content(
			readFileSync(source_path, 'utf8'),
			spec,
			source_root,
			destination,
		)

		write_atomically(path.join(destination, spec.cache_file), content)
	} catch {
		// A missing, changing, or malformed cache is a miss, never a failed lane or gate.
	}
}

/**
 * Copy the gate's verification caches from `source_root` into `destination`, skipping any the
 * source does not have. Warming is best-effort and never throws.
 */
function seed_caches(source_root: string, destination: string): void {
	for (const spec of GATE_CACHE_SPECS) copy_if_present(source_root, destination, spec)
}

function sync_cache(source_root: string, destination: string, cache_file: string): void {
	const spec = SHARED_CACHE_SPECS.find((candidate) => candidate.cache_file === cache_file)

	if (spec === undefined) return

	copy_if_present(source_root, destination, spec)
}

const lane_cache = { seed_caches, sync_cache }

export { lane_cache }
