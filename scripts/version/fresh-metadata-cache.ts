import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const CACHE_DIRECTORY_PREFIX = 'josh-latest-cache-'
const CACHE_DIRECTORY_FLAG = '--config.cache-dir='

// Points every stage at one metadata cache directory. pnpm keeps registry metadata there and the
// package store elsewhere, so an empty one costs a metadata refetch, never a tarball download.
function with_cache_directory(
	stages: ReadonlyArray<ReadonlyArray<string>>,
	cache_directory: string,
): Array<Array<string>> {
	return stages.map((stage) => [...stage, `${CACHE_DIRECTORY_FLAG}${cache_directory}`])
}

// A cached metadata file written through safe-chain lacks every version that was under 24 hours old
// at the time, and with `minimumReleaseAge` set pnpm reuses a cache file younger than that age
// instead of refetching it — so a version that has since aged in stays invisible for up to a day.
// A fresh directory per run means nothing filtered earlier is ever read.
function run_in_fresh_cache<T>(
	stages: ReadonlyArray<ReadonlyArray<string>>,
	run_stages: (stages: Array<Array<string>>) => T,
): T {
	const cache_directory = mkdtempSync(path.join(tmpdir(), CACHE_DIRECTORY_PREFIX))

	try {
		return run_stages(with_cache_directory(stages, cache_directory))
	} finally {
		rmSync(cache_directory, { recursive: true, force: true })
	}
}

const fresh_metadata_cache = { with_cache_directory, run_in_fresh_cache }

export { fresh_metadata_cache }
