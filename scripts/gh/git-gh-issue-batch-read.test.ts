import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_issue_batch_graphql, type BatchRead } from './git-gh-issue-batch-graphql'
import { git_gh_issue_batch_read, type BatchReader } from './git-gh-issue-batch-read'
import { PLAN_FIELDS } from './git-gh-issue-read'
import { git_gh_transport, TRANSPORT_ENV_VAR } from './git-gh-transport'

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/other'

function batch_of(issue_numbers: ReadonlyArray<number>): BatchRead {
	return {
		reads: new Map(
			issue_numbers.map((issue_number) => [
				issue_number,
				git_gh_issue_batch_graphql.answered(String(issue_number)),
			]),
		),
		cost: 0,
		remaining: undefined,
	}
}

const read_rest = vi.fn(async (issue_number: number) => `rest ${String(issue_number)}`)

function reader(repo?: string): BatchReader<string> {
	return { repo, from_json: (json) => `batch ${json}`, read_rest }
}

beforeEach(() => {
	vi.restoreAllMocks()
	read_rest.mockClear()
	vi.stubEnv(TRANSPORT_ENV_VAR, 'graphql')
})

describe('git_gh_issue_batch_read.read_each — the batch first', () => {
	it('answers every number the batch answered without a REST read', async () => {
		vi.spyOn(git_gh_issue_batch_graphql, 'read_many').mockResolvedValue(batch_of([1, 2]))
		const reads = await git_gh_issue_batch_read.read_each([1, 2], reader())

		expect(reads).toEqual([
			[1, 'batch 1'],
			[2, 'batch 2'],
		])
		expect(read_rest).not.toHaveBeenCalled()
	})

	it('reads through REST only the numbers the batch left unanswered', async () => {
		vi.spyOn(git_gh_issue_batch_graphql, 'read_many').mockResolvedValue(batch_of([1]))
		const reads = await git_gh_issue_batch_read.read_each([1, 2], reader())

		expect(reads).toEqual([
			[1, 'batch 1'],
			[2, 'rest 2'],
		])
		expect(read_rest.mock.calls).toEqual([[2]])
	})

	it('asks the batch for the repository and fields the reader names', async () => {
		const read_many = vi.spyOn(git_gh_issue_batch_graphql, 'read_many')

		read_many.mockResolvedValue(batch_of([1]))
		await git_gh_issue_batch_read.read_each([1], { ...reader(OTHER_REPO), fields: PLAN_FIELDS })

		expect(read_many).toHaveBeenCalledWith([1], OTHER_REPO, PLAN_FIELDS)
	})
})

describe('git_gh_issue_batch_read.read_each — GraphQL unavailable', () => {
	it('reads every number through REST when the query answers nothing', async () => {
		vi.spyOn(git_gh_transport, 'query_partial').mockResolvedValue(undefined)
		const reads = await git_gh_issue_batch_read.read_each([1, 2], reader(REPO))

		expect(reads).toEqual([
			[1, 'rest 1'],
			[2, 'rest 2'],
		])
	})
})

describe('git_gh_issue_batch_read.read_across', () => {
	it('reads each repository once and answers in the order given', async () => {
		const read_many = vi.spyOn(git_gh_issue_batch_graphql, 'read_many')

		read_many.mockResolvedValue(batch_of([1, 2]))
		const reads = await git_gh_issue_batch_read.read_across(
			[{ number: 1 }, { number: 2, repo: OTHER_REPO }, { number: 2 }],
			reader,
		)

		expect(reads).toEqual(['batch 1', 'batch 2', 'batch 2'])
		expect(read_many.mock.calls.map(([numbers, repo]) => [numbers, repo])).toEqual([
			[[1, 2], undefined],
			[[2], OTHER_REPO],
		])
	})
})
