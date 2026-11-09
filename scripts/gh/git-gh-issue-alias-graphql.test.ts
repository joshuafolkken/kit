import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_alias_graphql } from './git-gh-issue-alias-graphql'
import { TRANSPORT_ENV_VAR } from './git-gh-transport'

// joshuafolkken/kit#6791: any fields of many issues, one GraphQL query per hundred.

vi.mock('./git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: vi.fn() } }))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const REPO = 'joshuafolkken/kit'
const FIELDS = 'title'
const COST = 2
const REMAINING = 4990
const ISSUE_COUNT = 150
const QUERY_COUNT = 2

const title_schema = z.object({ title: z.string() })

function answer(issue_numbers: ReadonlyArray<number>, missing: ReadonlyArray<number> = []): string {
	const repository = Object.fromEntries(
		issue_numbers.map((issue_number) => [
			`issue${String(issue_number)}`,
			// eslint-disable-next-line unicorn/no-null -- GraphQL answers `null` for a number that resolves to nothing
			missing.includes(issue_number) ? null : { title: `Issue ${String(issue_number)}` },
		]),
	)

	return JSON.stringify({ data: { rateLimit: { cost: COST, remaining: REMAINING }, repository } })
}

function numbers_to(count: number): Array<number> {
	return Array.from({ length: count }, (_, index) => index + 1)
}

async function read(
	issue_numbers: ReadonlyArray<number>,
): ReturnType<typeof git_gh_issue_alias_graphql.read_aliased<z.infer<typeof title_schema>>> {
	return await git_gh_issue_alias_graphql.read_aliased(issue_numbers, FIELDS, title_schema, REPO)
}

beforeEach(() => {
	mocked_api.mockReset()
	vi.stubEnv(TRANSPORT_ENV_VAR, 'graphql')
})

describe('git_gh_issue_alias_graphql.read_aliased', () => {
	it('answers each issue in the schema the caller names, with the rate-limit read', async () => {
		mocked_api.mockResolvedValue(answer([7]))

		await expect(read([7])).resolves.toStrictEqual({
			answers: new Map([[7, { title: 'Issue 7' }]]),
			cost: COST,
			remaining: REMAINING,
		})
		expect(String(mocked_api.mock.calls[0]?.[0].body)).toContain(
			'issue7: issue(number: 7) { title }',
		)
	})

	it('reads more than a hundred issues one query per hundred, summing the cost', async () => {
		mocked_api.mockImplementation(async () => await answer(numbers_to(ISSUE_COUNT)))
		const batch = await read(numbers_to(ISSUE_COUNT))

		expect(mocked_api).toHaveBeenCalledTimes(QUERY_COUNT)
		expect(batch.answers.size).toBe(ISSUE_COUNT)
		expect(batch.cost).toBe(COST * QUERY_COUNT)
	})

	it('leaves out a number that resolves to nothing', async () => {
		mocked_api.mockResolvedValue(answer([1, 2], [2]))

		const { answers } = await read([1, 2])

		expect([...answers.keys()]).toStrictEqual([1])
	})
})

describe('git_gh_issue_alias_graphql.read_aliased — nothing sent', () => {
	it('sends nothing and answers nothing on a REST session', async () => {
		vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
		const { answers } = await read([1])

		expect(answers.size).toBe(0)
		expect(mocked_api).not.toHaveBeenCalled()
	})

	it('sends nothing for no issues', async () => {
		const { answers } = await read([])

		expect(answers.size).toBe(0)
		expect(mocked_api).not.toHaveBeenCalled()
	})
})
