import { git_gh_command } from '#scripts/git/git-gh-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_fetch } from './epic-fetch'

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const GET_CHILD = 'issue_get_state_and_relations'
const IN_PROGRESS = 'in-progress'

// The shape `gh issue view --json number,state,labels,blockedBy` actually answers with, measured
// against a real issue: `blockedBy` is a GraphQL connection, not a bare array.
function gh_child(input: {
	number: number
	state?: string
	labels?: ReadonlyArray<string>
	blocked_by?: ReadonlyArray<number>
}): string {
	return JSON.stringify({
		number: input.number,
		state: input.state ?? 'OPEN',
		labels: (input.labels ?? []).map((name) => ({ name })),
		blockedBy: {
			nodes: (input.blocked_by ?? []).map((number) => ({ number })),
			totalCount: (input.blocked_by ?? []).length,
		},
	})
}

beforeEach(() => {
	vi.restoreAllMocks()
})

describe('epic_fetch.fetch_child', () => {
	it('unwraps the blockedBy connection into plain issue numbers', async () => {
		vi.spyOn(git_gh_command, GET_CHILD).mockResolvedValue(gh_child({ number: 2, blocked_by: [1] }))
		const child = await epic_fetch.fetch_child(2, REPO)

		expect(child?.blocked_by).toEqual([1])
	})

	it('reads a child with no relations at all', async () => {
		vi.spyOn(git_gh_command, GET_CHILD).mockResolvedValue(
			JSON.stringify({ number: 1, state: 'OPEN' }),
		)
		const child = await epic_fetch.fetch_child(1, REPO)

		expect(child?.blocked_by).toEqual([])
	})

	it('picks the label names out of the label objects', async () => {
		const raw = gh_child({ number: 1, labels: [IN_PROGRESS] })

		vi.spyOn(git_gh_command, GET_CHILD).mockResolvedValue(raw)
		const child = await epic_fetch.fetch_child(1, REPO)

		expect(child?.labels).toEqual([IN_PROGRESS])
	})

	it('normalizes the state gh reports', async () => {
		vi.spyOn(git_gh_command, GET_CHILD).mockResolvedValue(gh_child({ number: 1, state: 'closed' }))
		const child = await epic_fetch.fetch_child(1, REPO)

		expect(child?.state).toBe('CLOSED')
	})

	it('stamps the repository it was asked about', async () => {
		vi.spyOn(git_gh_command, GET_CHILD).mockResolvedValue(gh_child({ number: 1 }))
		const child = await epic_fetch.fetch_child(1, REPO)

		expect(child?.repo).toBe(REPO)
	})
})

describe('epic_fetch.fetch_child — what it refuses to guess', () => {
	it('reports a child gh could not answer for', async () => {
		vi.spyOn(git_gh_command, GET_CHILD).mockResolvedValue(undefined)

		expect(await epic_fetch.fetch_child(1, REPO)).toBeUndefined()
	})

	// gh's JSON is somebody else's contract, and `epic:next` is what a run asks when it needs to know
	// where it stands — a shape surprise must not take the command down.
	it('reports a child whose JSON does not match the expected shape', async () => {
		vi.spyOn(git_gh_command, GET_CHILD).mockResolvedValue('{"unexpected": true}')

		expect(await epic_fetch.fetch_child(1, REPO)).toBeUndefined()
	})

	it('reports a child whose response is not JSON at all', async () => {
		vi.spyOn(git_gh_command, GET_CHILD).mockResolvedValue('gh: Not Found (HTTP 404)')

		expect(await epic_fetch.fetch_child(1, REPO)).toBeUndefined()
	})
})

describe('epic_fetch.fetch_children', () => {
	it('keeps the children it could read', async () => {
		vi.spyOn(git_gh_command, GET_CHILD).mockImplementation(async (number: string) =>
			gh_child({ number: Number(number) }),
		)
		const fetched = await epic_fetch.fetch_children([1, 2], REPO)

		expect(fetched.children.map((child) => child.number)).toEqual([1, 2])
		expect(fetched.unreadable).toEqual([])
	})

	// Dropping them silently is what made a fully open epic read as complete.
	it('names the children it could not read instead of dropping them', async () => {
		vi.spyOn(git_gh_command, GET_CHILD).mockImplementation(async (number: string) =>
			number === '1' ? gh_child({ number: 1 }) : undefined,
		)
		const fetched = await epic_fetch.fetch_children([1, 2], REPO)

		expect(fetched.children).toHaveLength(1)
		expect(fetched.unreadable).toEqual([2])
	})

	it('reports what it skipped rather than truncating in silence', async () => {
		vi.spyOn(git_gh_command, GET_CHILD).mockResolvedValue(gh_child({ number: 1 }))
		const numbers = Array.from({ length: epic_fetch.CHILD_LIMIT + 2 }, (_, index) => index + 1)
		const fetched = await epic_fetch.fetch_children(numbers, REPO)

		expect(fetched.skipped).toHaveLength(2)
	})
})

// The one definition of the `--repo` scope a child is read through. Every read of a child's fields
// follows it, bodies included (joshuafolkken/kit#1012).
describe('epic_fetch.scope_for', () => {
	// Unqualified is what `fetch_children` already does, and what keeps a read working when the
	// current repository could not be named at all.
	it('leaves a child in the current repository unqualified', () => {
		expect(epic_fetch.scope_for(REPO, REPO)).toBeUndefined()
	})

	it('scopes a child elsewhere to its own repository', () => {
		expect(epic_fetch.scope_for(OTHER_REPO, REPO)).toBe(OTHER_REPO)
	})
})
