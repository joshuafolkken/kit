import { describe, expect, it } from 'vitest'
import { bundle_flag } from './bundle-flag'

// joshuafolkken/kit#8344: the build replaces the flag's variable with a constant, so only a bundled
// module reads it as set; the build itself is pinned in `build-commands.test.ts`.

describe('bundle_flag', () => {
	it('defines the variable the flag reads as the bundled value', () => {
		expect(Object.entries(bundle_flag.BUNDLED_DEFINE)).toStrictEqual([
			['process.env.JOSH_BUNDLED', '"true"'],
		])
	})

	it('reads as source when run unbundled', () => {
		expect(bundle_flag.is_bundled()).toBe(false)
	})
})
