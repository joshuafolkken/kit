import { describe, expect, it } from 'vitest'
import { vitest_cache_directory } from './vitest-cache-directory'

const TREE_CACHE = 'josh-test-pinned-x/vite-cache'

describe('vitest_cache_directory.config_cache_directory', () => {
	it('names the directory a throwaway tree run passes', () => {
		const environment = { [vitest_cache_directory.CACHE_DIRECTORY_KEY]: TREE_CACHE }

		expect(vitest_cache_directory.config_cache_directory(environment)).toBe(TREE_CACHE)
	})

	it.each([{}, { [vitest_cache_directory.CACHE_DIRECTORY_KEY]: '' }])(
		'leaves the default for a run that names none (%o)',
		(environment) => {
			expect(vitest_cache_directory.config_cache_directory(environment)).toBeUndefined()
		},
	)
})
