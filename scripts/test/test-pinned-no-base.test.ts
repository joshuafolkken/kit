import { change_base } from '#scripts/git/change-base'
import { changed_paths } from '#scripts/git/changed-paths'
import { afterEach, expect, it, vi } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_logic } from './test-pinned-logic'

afterEach(() => {
	vi.restoreAllMocks()
})

it('checks nothing when there is no merge-base', async () => {
	vi.spyOn(change_base, 'resolved_through_merge').mockResolvedValue(undefined)

	expect(await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)).toMatchObject({
		unpinned: [],
		unchecked: [],
		unparsed: [],
	})
})

// A checkout without the default branch (CI's) fails any diff against it, so none is read.
it('reads no changed paths when there is no merge-base', async () => {
	vi.spyOn(change_base, 'resolved_through_merge').mockResolvedValue(undefined)
	const read = vi.spyOn(changed_paths, 'read_changed_since')

	await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)

	expect(read).not.toHaveBeenCalled()
})
