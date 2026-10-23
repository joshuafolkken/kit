import { change_base } from '#scripts/git/change-base'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_spawn } from '#scripts/git/git-spawn'
import { review_code_tree } from '#scripts/review/review-code-tree'
import { afterEach, expect, it, vi } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_logic } from './test-pinned-logic'

// joshuafolkken/kit#4647: without `typescript` (an optional peer in a consumer) an added file's
// functions cannot be read, so it is reported unchecked rather than passed as pinned, and a changed
// hunk is kept, comment or not, since its emit cannot be compared.

const CHANGED = 'scripts/test/test-pinned.ts'
const ADDED = 'scripts/test/test-pinned-emit.ts'
const COMMENT_DIFF = [
	`diff --git a/${CHANGED} b/${CHANGED}`,
	`--- a/${CHANGED}`,
	`+++ b/${CHANGED}`,
	'@@ -3 +3 @@',
	'-// an old comment',
	'+// a new comment',
	'',
].join('\n')

afterEach(() => {
	vi.restoreAllMocks()
})

it('reports an added file unchecked and keeps a comment hunk when typescript is absent', async () => {
	vi.spyOn(change_base, 'resolved').mockResolvedValue('base')
	vi.spyOn(changed_paths, 'read_changed_paths').mockResolvedValue([CHANGED, ADDED])
	vi.spyOn(changed_paths, 'read_held_at').mockResolvedValue([CHANGED])
	vi.spyOn(git_spawn, 'read').mockResolvedValue(COMMENT_DIFF)
	vi.spyOn(review_code_tree, 'load_typescript').mockReturnValue(undefined)

	const report = await test_pinned.run(0)

	expect(report.unparsed).toEqual([ADDED])
	expect(report.unchecked.map((hunk) => test_pinned_logic.location(hunk))).toEqual([`${CHANGED}:3`])
})
