import { git_gh_command } from '#scripts/git/git-gh-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_fetch } from './epic-fetch'

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const GET_CHILD = 'issue_get_state_and_relations'
const GET_BODY = 'issue_get_body'
const THIRD_PARTY_REPO = 'sveltejs/kit'
const EPIC = 858
const IN_PROGRESS = 'in-progress'

// The shape a `number,state,labels,blockedBy` read actually answers with, measured against a real
// issue: `blockedBy` is a connection — `{ nodes, totalCount }` — not a bare array. GraphQL selected
// it that way; REST serves a bare array from the issue's own dependencies endpoint, which
// `git-gh-issue-rest.ts` maps back into the connection (joshuafolkken/kit#1024).
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

// The epic's own body, which decides which rows the fetch then tries to read.
function epic_body(rows: string): void {
	vi.spyOn(git_gh_command, GET_BODY).mockResolvedValue(rows)
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
		expect(fetched.unreadable).toEqual([{ repo: REPO, number: 2 }])
	})

	it('reports what it skipped rather than truncating in silence', async () => {
		vi.spyOn(git_gh_command, GET_CHILD).mockResolvedValue(gh_child({ number: 1 }))
		const numbers = Array.from({ length: epic_fetch.CHILD_LIMIT + 2 }, (_, index) => index + 1)
		const fetched = await epic_fetch.fetch_children(numbers, REPO)

		expect(fetched.skipped).toHaveLength(2)
		expect(fetched.skipped[0]?.repo).toBe(REPO)
	})
})

// A child that could not be read is named with the repository it lives in. Reported as a bare number,
// `- [ ] sveltejs/kit#7` came out as `Could not read #7` and sent the reader to this repository's
// issue 7 (joshuafolkken/kit#1016).
describe('epic_fetch.fetch_epic — naming what it could not read', () => {
	// The repository the *reader* is standing in, not the one the epic lives in: an unread child of a
	// qualified epic written bare would send them to their own issue of that number.
	it('carries the repository the command is running in', async () => {
		epic_body('- [ ] #1')
		vi.spyOn(git_gh_command, GET_CHILD).mockResolvedValue(gh_child({ number: 1 }))
		const snapshot = await epic_fetch.fetch_epic(EPIC, OTHER_REPO, REPO)

		expect(snapshot.current_repo).toBe(REPO)
	})

	it('names a local child it could not read as this repository', async () => {
		epic_body('- [ ] #7')
		vi.spyOn(git_gh_command, GET_CHILD).mockResolvedValue(undefined)
		const snapshot = await epic_fetch.fetch_epic(EPIC, REPO)

		expect(snapshot.unreadable).toEqual([{ repo: REPO, number: 7 }])
	})

	// The owner restriction refuses this row before it is read; the number alone said nothing about
	// which tracker it belongs to.
	it('names a child the owner restriction refused with its own repository', async () => {
		epic_body(`- [ ] ${THIRD_PARTY_REPO}#7`)
		vi.spyOn(git_gh_command, GET_CHILD).mockResolvedValue(undefined)
		const snapshot = await epic_fetch.fetch_epic(EPIC, REPO)

		expect(snapshot.unreadable).toEqual([{ repo: THIRD_PARTY_REPO, number: 7 }])
	})

	it('names a child in a sibling repository it could not read with that repository', async () => {
		epic_body(`- [ ] ${OTHER_REPO}#40`)
		vi.spyOn(git_gh_command, GET_CHILD).mockResolvedValue(undefined)
		const snapshot = await epic_fetch.fetch_epic(EPIC, REPO)

		expect(snapshot.unreadable).toEqual([{ repo: OTHER_REPO, number: 40 }])
	})
})

// A qualified epic lives somewhere else, and its task-list rows name issues there. Read unqualified,
// the body came from *this* repository's issue of that number and its rows were read here too, while
// the children were still stamped with the other repository (joshuafolkken/kit#1016).
describe('epic_fetch.fetch_epic — the repository the epic itself lives in', () => {
	it('reads an epic in this repository unqualified, exactly as before', async () => {
		const get_body = vi.spyOn(git_gh_command, GET_BODY).mockResolvedValue('- [ ] #1')
		const get_child = vi.spyOn(git_gh_command, GET_CHILD).mockResolvedValue(gh_child({ number: 1 }))

		await epic_fetch.fetch_epic(EPIC, REPO)

		expect(get_body).toHaveBeenCalledWith(String(EPIC), undefined)
		expect(get_child).toHaveBeenCalledWith('1', undefined)
	})

	// joshuafolkken/kit#869's restriction is about who *we* are. Derived from the epic's repository
	// instead, a qualified reference to somebody else's epic would have made their whole organization
	// readable through the very read that was just added.
	it('takes the owner allow-list from the repository the command runs in', async () => {
		epic_body(`- [ ] ${THIRD_PARTY_REPO}#7`)
		const get_child = vi.spyOn(git_gh_command, GET_CHILD).mockResolvedValue(undefined)
		const snapshot = await epic_fetch.fetch_epic(EPIC, THIRD_PARTY_REPO, REPO)

		expect(get_child).not.toHaveBeenCalled()
		expect(snapshot.unreadable).toEqual([{ repo: THIRD_PARTY_REPO, number: 7 }])
	})

	it('reads an epic elsewhere, and its rows, through that repository', async () => {
		const get_body = vi.spyOn(git_gh_command, GET_BODY).mockResolvedValue('- [ ] #1')
		const get_child = vi.spyOn(git_gh_command, GET_CHILD).mockResolvedValue(gh_child({ number: 1 }))

		await epic_fetch.fetch_epic(EPIC, OTHER_REPO, REPO)

		expect(get_body).toHaveBeenCalledWith(String(EPIC), OTHER_REPO)
		expect(get_child).toHaveBeenCalledWith('1', OTHER_REPO)
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
