import { lane_background } from '#scripts/rules/lane-background'
import { describe, expect, it } from 'vitest'
import { main_merge_guard } from './main-merge-guard'

// joshuafolkken/kit#2445: a lane child merged the default branch over uncommitted work, stashed around
// the refusal, and was left with `UU` in the index and a request for `git add`. These pin the two
// states the merge is refused in, and that an unrelated dirty tree still merges.

const CHANGED_FILE = 'scripts/a.ts'
const OLD_NAME = 'old.ts'
const CONFLICTED = 'UU scripts/run/event/run-event-stream.ts\n M scripts/other.ts'
const DIRTY = ` M ${CHANGED_FILE}\n?? scripts/new.ts`
const COMMIT_COMMAND = 'pnpm josh git -y'
const LANE_COMMIT_COMMAND = 'pnpm josh git -y --skip-push --skip-pr "<title> #<N>"'
const UNTOUCHED_FILE = 'elsewhere.ts'

describe('main_merge_guard.unmerged_paths', () => {
	it('lists every unresolved status code', () => {
		const status = 'UU a.ts\nAA b.ts\nDU c.ts\n M d.ts'

		expect(main_merge_guard.unmerged_paths(status)).toEqual(['a.ts', 'b.ts', 'c.ts'])
	})

	it('keeps the leading space of the first line out of the path', () => {
		expect(main_merge_guard.unmerged_paths(' M a.ts')).toEqual([])
	})
})

describe('main_merge_guard.staged_paths', () => {
	it('lists paths with a staged index column and skips unstaged and untracked ones', () => {
		const status = 'M  a.ts\nA  b.ts\n M c.ts\n?? d.ts\nMM e.ts'

		expect(main_merge_guard.staged_paths(status)).toEqual(['a.ts', 'b.ts', 'e.ts'])
	})
})

describe('main_merge_guard.overlapping_paths', () => {
	it('finds an uncommitted path the default branch also changed', () => {
		expect(main_merge_guard.overlapping_paths(DIRTY, [CHANGED_FILE, 'x.ts'])).toEqual([
			CHANGED_FILE,
		])
	})

	it('reads both sides of a rename', () => {
		expect(main_merge_guard.overlapping_paths(`R  ${OLD_NAME} -> new.ts`, [OLD_NAME])).toEqual([
			OLD_NAME,
		])
	})

	it('covers incoming paths beneath an untracked directory', () => {
		expect(main_merge_guard.overlapping_paths('?? docs/', ['docs/a.md'])).toEqual(['docs/'])
	})

	it('finds nothing when the two sides are disjoint', () => {
		expect(main_merge_guard.overlapping_paths(DIRTY, [UNTOUCHED_FILE])).toEqual([])
	})
})

describe('main_merge_guard.refusal', () => {
	it('refuses unresolved paths and routes them through the commit flow', () => {
		const refusal = main_merge_guard.refusal(CONFLICTED, [], 'main')

		expect(refusal).toContain('scripts/run/event/run-event-stream.ts')
		expect(refusal).toContain(COMMIT_COMMAND)
	})

	it('refuses an overlap and tells the run to commit first, never to stash', () => {
		const refusal = main_merge_guard.refusal(DIRTY, ['scripts/new.ts'], 'develop')

		expect(refusal).toContain('origin/develop')
		expect(refusal).toContain(COMMIT_COMMAND)
		expect(refusal).toContain('Never stash')
	})

	it('refuses staged changes even on a path the merge does not touch', () => {
		const refusal = main_merge_guard.refusal(`M  ${UNTOUCHED_FILE}`, [CHANGED_FILE], 'main')

		expect(refusal).toContain(UNTOUCHED_FILE)
		expect(refusal).toContain(COMMIT_COMMAND)
	})

	it('lets staged changes through when the default branch brings nothing in', () => {
		expect(main_merge_guard.refusal(`M  ${UNTOUCHED_FILE}`, [], 'main')).toBeUndefined()
	})

	it('lets a dirty tree the merge does not touch through', () => {
		expect(main_merge_guard.refusal(DIRTY, [UNTOUCHED_FILE], 'main')).toBeUndefined()
	})

	it('lets a clean tree through', () => {
		expect(main_merge_guard.refusal('', [CHANGED_FILE], 'main')).toBeUndefined()
	})
})

function guided_command(is_lane_child: boolean): string {
	const commit = main_merge_guard.commit_command(is_lane_child)
	const refusal = main_merge_guard.refusal(CONFLICTED, [], 'main', commit) ?? ''

	return /`(?<command>pnpm josh git -y[^`]*)`/u.exec(refusal)?.groups?.['command'] ?? ''
}

// joshuafolkken/kit#4769: a lane child told to close the merge through a pushing `git -y` was refused
// by the lane-background row, so a lane child is told the commit-only form `josh ship` closes it with.
describe('main_merge_guard.refusal in a lane child', () => {
	it('routes a lane child through the commit-only form', () => {
		expect(guided_command(true)).toBe(LANE_COMMIT_COMMAND)
	})

	it('keeps the pushing form outside a lane child', () => {
		expect(guided_command(false)).toBe(COMMIT_COMMAND)
	})

	it('guides a lane child to a command the lane-background row lets through', () => {
		const call = { name: 'Bash', input: { command: guided_command(true) } }

		expect(lane_background.is_background_long_run(call, () => true)).toBe(false)
	})

	it.each([
		['staged changes', `M  ${UNTOUCHED_FILE}`],
		['an overlap', DIRTY],
	])('tells a lane child the commit-only form over %s too', (_label, status) => {
		const commit = main_merge_guard.commit_command(true)

		expect(main_merge_guard.refusal(status, [CHANGED_FILE], 'main', commit)).toContain(
			LANE_COMMIT_COMMAND,
		)
	})

	it('tells a lane child the commit-only form for a conflicted merge too', () => {
		const commit = main_merge_guard.commit_command(true)

		expect(main_merge_guard.conflict_hint(commit)).toContain(LANE_COMMIT_COMMAND)
	})
})
