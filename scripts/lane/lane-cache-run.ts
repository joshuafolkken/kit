import path from 'node:path'
import { lane_cache } from './lane-cache'
import { lane_registry } from './lane-registry'

async function resolve_main_root(): Promise<string | undefined> {
	try {
		return await lane_registry.main_repository_root()
	} catch {
		return undefined
	}
}

// Each tool owns its cache for exactly its process lifetime (#2060): refresh immediately before it
// starts and publish in `finally` immediately after it settles. Other gate failures therefore cannot
// discard completed work, while the main checkout pays no copy or rewrite at all. Root discovery is
// best-effort too: a consumer outside Git still runs the requested tool without cache sharing.
async function run<T>(
	cache_file: string,
	work: () => Promise<T>,
	current_root: string = process.cwd(),
): Promise<T> {
	const main_root = await resolve_main_root()

	if (main_root === undefined || path.resolve(current_root) === path.resolve(main_root)) {
		return await work()
	}

	lane_cache.sync_cache(main_root, current_root, cache_file)

	try {
		return await work()
	} finally {
		lane_cache.sync_cache(current_root, main_root, cache_file)
	}
}

const lane_cache_run = { run }

export { lane_cache_run }
