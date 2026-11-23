import { git_gh_issue_graphql } from '#scripts/gh/git-gh-issue-graphql'
import { git_gh_transport } from '#scripts/gh/git-gh-transport'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rework_reference_state } from './rework-reference-state'

const MERGED = 1
const CLOSED = 2
const OPEN = 3
const UNMERGED = 4
// No alias in the answer: a number that resolves to nothing.
const MISSING = 5

function answer(): string {
	return JSON.stringify({
		data: {
			repository: {
				n1: { kind: 'PullRequest', state: 'MERGED' },
				n2: { kind: 'Issue', state: 'CLOSED' },
				n3: { kind: 'Issue', state: 'OPEN' },
				n4: { kind: 'PullRequest', state: 'CLOSED' },
			},
		},
	})
}

beforeEach(() => {
	vi.spyOn(git_gh_issue_graphql, 'repository_variables_of').mockReturnValue({
		owner: 'o',
		name: 'r',
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('rework_reference_state.delivered', () => {
	it('keeps merged pull requests and closed Issues only', async () => {
		vi.spyOn(git_gh_transport, 'query_partial').mockResolvedValue(answer())

		const delivered = await rework_reference_state.delivered([
			MERGED,
			CLOSED,
			OPEN,
			UNMERGED,
			MISSING,
		])

		expect([...(delivered ?? [])]).toStrictEqual([MERGED, CLOSED])
	})

	it('answers undefined when the query goes unanswered', async () => {
		vi.spyOn(git_gh_transport, 'query_partial').mockResolvedValue(undefined)

		await expect(rework_reference_state.delivered([MERGED])).resolves.toBeUndefined()
	})

	it('asks nothing for no numbers', async () => {
		const query = vi.spyOn(git_gh_transport, 'query_partial')

		await expect(rework_reference_state.delivered([])).resolves.toStrictEqual(new Set())
		expect(query).not.toHaveBeenCalled()
	})
})
