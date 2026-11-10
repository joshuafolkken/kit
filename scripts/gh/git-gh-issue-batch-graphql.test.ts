import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_batch_graphql } from './git-gh-issue-batch-graphql'
import { PLAN_FIELDS } from './git-gh-issue-read'
import { TRANSPORT_ENV_VAR } from './git-gh-transport'

vi.mock('./git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: vi.fn() } }))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const REPO = 'joshuafolkken/kit'
const CHILD_COUNT = 200
const QUERY_COUNT = 2
const COST = 3
const REMAINING = 4990

function issue_node(issue_number: number): object {
	return {
		number: issue_number,
		title: `Child ${String(issue_number)}`,
		state: 'OPEN',
		body: 'Body',
		url: `https://github.com/${REPO}/issues/${String(issue_number)}`,
		createdAt: '2026-11-01T00:00:00Z',
		authorAssociation: 'OWNER',
		author: { login: 'joshuafolkken', type: 'User' },
		labels: { nodes: [{ name: 'enhancement' }] },
		blockedBy: {
			totalCount: 1,
			nodes: [{ number: 1, state: 'CLOSED', repository: { nameWithOwner: REPO } }],
		},
	}
}

function answer(issue_numbers: ReadonlyArray<number>, missing: ReadonlyArray<number> = []): string {
	const repository = Object.fromEntries(
		issue_numbers.map((issue_number) => [
			`issue${String(issue_number)}`,
			// eslint-disable-next-line unicorn/no-null -- GraphQL answers `null` for a number that resolves to nothing
			missing.includes(issue_number) ? null : issue_node(issue_number),
		]),
	)

	return JSON.stringify({ data: { rateLimit: { cost: COST, remaining: REMAINING }, repository } })
}

// A pull request answers `... on Issue` with no fields at all.
function with_pull_request(json: string, issue_number: number): string {
	const parsed = JSON.parse(json) as { data: { repository: Record<string, object> } }

	parsed.data.repository[`issue${String(issue_number)}`] = {}

	return JSON.stringify(parsed)
}

// `gh` exits non-zero on a document with `errors`, and the execa error keeps the body on `stdout`.
function partial_error(issue_numbers: ReadonlyArray<number>, missing: number): Error {
	const document = JSON.parse(answer(issue_numbers, [missing])) as object
	const errors = [{ type: 'NOT_FOUND', path: ['repository', `issue${String(missing)}`] }]
	const stdout = JSON.stringify({ ...document, errors })

	return new Error('gh: Could not resolve to an issue', {
		cause: Object.assign(new Error('exit 1'), { stdout }),
	})
}

function numbers_to(count: number): Array<number> {
	return Array.from({ length: count }, (_, index) => index + 1)
}

beforeEach(() => {
	mocked_api.mockReset()
	vi.stubEnv(TRANSPORT_ENV_VAR, 'graphql')
})

describe('git_gh_issue_batch_graphql.read_many — the REST shape', () => {
	it('answers each child in the fields a state-and-relations read names', async () => {
		mocked_api.mockResolvedValue(answer([2]))
		const batch = await git_gh_issue_batch_graphql.read_many([2], REPO)
		const read = batch.reads.get(2)

		expect(read?.kind).toBe('read')
		expect(read?.kind === 'read' ? JSON.parse(read.json) : undefined).toEqual({
			number: 2,
			state: 'OPEN',
			labels: [{ name: 'enhancement' }],
			blockedBy: {
				nodes: [
					{ number: 1, state: 'CLOSED', repository_url: `https://api.github.com/repos/${REPO}` },
				],
				totalCount: 1,
			},
			body: 'Body',
			author_association: 'OWNER',
			user: { login: 'joshuafolkken' },
		})
	})

	it('reads the rate limit the queries spent', async () => {
		mocked_api.mockImplementation(async () => answer(numbers_to(CHILD_COUNT)))
		const batch = await git_gh_issue_batch_graphql.read_many(numbers_to(CHILD_COUNT), REPO)

		expect(batch.cost).toBe(COST * QUERY_COUNT)
		expect(batch.remaining).toBe(REMAINING)
	})
})

describe('git_gh_issue_batch_graphql.read_many — the fields asked for', () => {
	it('answers the plan fields, title and URL included, when asked for them', async () => {
		mocked_api.mockResolvedValue(answer([2]))
		const batch = await git_gh_issue_batch_graphql.read_many([2], REPO, PLAN_FIELDS)
		const read = batch.reads.get(2)

		expect(read?.kind === 'read' ? JSON.parse(read.json) : undefined).toMatchObject({
			number: 2,
			title: 'Child 2',
			url: `https://github.com/${REPO}/issues/2`,
			state: 'OPEN',
		})
	})
})

describe('git_gh_issue_batch_graphql.read_many — a hundred per query', () => {
	it('reads two hundred children in two queries', async () => {
		mocked_api.mockImplementation(async () => answer(numbers_to(CHILD_COUNT)))
		const batch = await git_gh_issue_batch_graphql.read_many(numbers_to(CHILD_COUNT), REPO)

		expect(mocked_api).toHaveBeenCalledTimes(QUERY_COUNT)
		expect(batch.reads.size).toBe(CHILD_COUNT)
	})

	it('sends no query for no children', async () => {
		const batch = await git_gh_issue_batch_graphql.read_many([], REPO)

		expect(mocked_api).not.toHaveBeenCalled()
		expect(batch.reads.size).toBe(0)
	})
})

describe('git_gh_issue_batch_graphql.read_many — what it leaves to REST', () => {
	it('leaves a number that resolved to nothing unanswered', async () => {
		mocked_api.mockResolvedValue(answer([1, 2], [2]))
		const batch = await git_gh_issue_batch_graphql.read_many([1, 2], REPO)

		expect([...batch.reads.keys()]).toEqual([1])
	})

	it('leaves a pull request to REST and keeps the rest of its chunk', async () => {
		mocked_api.mockResolvedValue(with_pull_request(answer([1, 2, 3]), 2))
		const batch = await git_gh_issue_batch_graphql.read_many([1, 2, 3], REPO)

		expect([...batch.reads.keys()]).toEqual([1, 3])
	})

	it('keeps the answered children of a chunk holding a number that does not exist', async () => {
		mocked_api.mockRejectedValue(partial_error([1, 2, 3], 2))
		const batch = await git_gh_issue_batch_graphql.read_many([1, 2, 3], REPO)

		expect([...batch.reads.keys()]).toEqual([1, 3])
		expect(batch.remaining).toBe(REMAINING)
	})

	it('leaves every child unanswered when the query fails', async () => {
		mocked_api.mockRejectedValue(new Error('timeout'))
		const batch = await git_gh_issue_batch_graphql.read_many([1, 2], REPO)

		expect(batch.reads.size).toBe(0)
		expect(batch.remaining).toBeUndefined()
	})

	it('sends no query in a session on REST', async () => {
		vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
		const batch = await git_gh_issue_batch_graphql.read_many([1, 2], REPO)

		expect(mocked_api).not.toHaveBeenCalled()
		expect(batch.reads.size).toBe(0)
	})
})
