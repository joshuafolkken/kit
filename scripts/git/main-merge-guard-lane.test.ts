import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main_merge_guard } from './main-merge-guard'

// joshuafolkken/kit#4769: the guidance's command is resolved from the lane mark when no caller passes
// one — the path `josh main:merge` and `josh stash:push` take. Kept apart from
// `main-merge-guard.test.ts` because the spy makes this file need isolation.

const CONFLICTED = 'UU scripts/a.ts'
const LANE_COMMIT_COMMAND = '`pnpm josh git -y --skip-push --skip-pr "<title> #<N>"`'
const COMMIT_COMMAND = '`pnpm josh git -y`'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('main_merge_guard — the lane mark decides the guided command', () => {
	it.each([
		[true, LANE_COMMIT_COMMAND],
		[false, COMMIT_COMMAND],
	])('reads lane child %s as %s', (is_lane_child, command) => {
		vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(is_lane_child)

		expect(main_merge_guard.refusal(CONFLICTED, [], 'main')).toContain(command)
		expect(main_merge_guard.conflict_hint()).toContain(command)
		expect(main_merge_guard.unresolved_message('stash:push', ['a.ts'], 'it')).toContain(command)
	})
})
