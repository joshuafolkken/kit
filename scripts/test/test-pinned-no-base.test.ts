import { change_base } from '#scripts/git/change-base'
import { afterEach, expect, it, vi } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_logic } from './test-pinned-logic'

afterEach(() => {
	vi.restoreAllMocks()
})

it('checks nothing when there is no merge-base', async () => {
	vi.spyOn(change_base, 'resolved').mockResolvedValue(undefined)

	expect(await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)).toMatchObject({
		unpinned: [],
		unchecked: [],
		unparsed: [],
	})
})
