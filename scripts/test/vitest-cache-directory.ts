// The Vite cache directory `vitest.config.ts` hands a vitest run in a throwaway tree (joshuafolkken/kit#4770).
//
// **A tree from `base-tree.ts` borrows this checkout's `node_modules`**, and vitest keys its dependency
// optimizer's cache by project name alone, so a `josh test:red` / `josh test:pinned` run beside the gate
// re-bundled the same `node_modules/.vite/vitest/<hash>/deps_ssr` the gate was importing from, and a gate
// file failed on a deleted `execa.js`. The tree's run names a directory of its own through
// `CACHE_DIRECTORY_KEY`; any other run leaves it unset and keeps Vite's default.

const CACHE_DIRECTORY_KEY = 'JOSH_VITEST_CACHE_DIR'

function config_cache_directory(environment: NodeJS.ProcessEnv = process.env): string | undefined {
	const directory = environment[CACHE_DIRECTORY_KEY] ?? ''

	return directory === '' ? undefined : directory
}

const vitest_cache_directory = { CACHE_DIRECTORY_KEY, config_cache_directory }

export { vitest_cache_directory }
