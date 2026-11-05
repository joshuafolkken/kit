import { git_gh_command } from '#scripts/gh/git-gh-command'
import { afterEach, expect, it, vi } from 'vitest'
import { run_add_issue } from './run-add-issue'

const ISSUE = 6429

afterEach(() => vi.restoreAllMocks())

it.each([
	{ nodes: [], totalCount: 0, is_complete: true },
	{ nodes: [], totalCount: 1, is_complete: false },
	{ nodes: [], is_complete: false },
])('requires a complete blocker connection: %j', async ({ is_complete, ...blocked_by }) => {
	vi.spyOn(git_gh_command, 'issue_get_state_and_relations_classified').mockResolvedValue({
		kind: 'read',
		json: JSON.stringify({ number: ISSUE, state: 'OPEN', blockedBy: blocked_by }),
	})

	expect((await run_add_issue.read(ISSUE)) !== undefined).toBe(is_complete)
})

it.each(['not json', JSON.stringify({ number: ISSUE })])(
	'refuses a missing relation %s',
	async (json) => {
		vi.spyOn(git_gh_command, 'issue_get_state_and_relations_classified').mockResolvedValue({
			kind: 'read',
			json,
		})

		expect(await run_add_issue.read(ISSUE)).toBeUndefined()
	},
)
