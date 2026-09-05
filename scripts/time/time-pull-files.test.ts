import { describe, expect, it } from 'vitest'
import { time_github } from './time-github'
import { time_pull_files } from './time-pull-files'

// What a read of the merged diff's file listing produces (joshuafolkken/kit#1387).
//
// Every case here is about the same distinction: a refusal is not a pull request that changed
// nothing. Answering the first with the second would report every edited file as "never reached the
// merged diff", which is the silent zero this module exists to remove.

const PULL = 1387
const PATH = 'scripts/verification-gate.ts'
const ADDITIONS = 12
const DELETIONS = 3
const REFUSAL = 'gh: 403'

function body(rows: ReadonlyArray<object>): string {
	return JSON.stringify(rows)
}

function row(filename: string): object {
	return { filename, additions: ADDITIONS, deletions: DELETIONS, status: 'modified' }
}

async function list(text: string): Promise<ReturnType<typeof time_pull_files.list_pull_files>> {
	return await time_pull_files.list_pull_files(PULL, async () => text)
}

describe('time_pull_files.list_pull_files', () => {
	it('reads the path and the two line counts off each row', async () => {
		const answer = await list(body([row(PATH)]))

		expect(answer.is_failed).toBe(false)
		expect(answer.files).toEqual([{ path: PATH, additions: ADDITIONS, deletions: DELETIONS }])
	})

	it('asks the pulls path for that number', async () => {
		const asked: Array<string> = []

		await time_pull_files.list_pull_files(PULL, async (path) => {
			asked.push(path)

			return '[]'
		})

		expect(asked[0]).toContain(`${time_github.PULLS_PATH}/${String(PULL)}/files`)
	})

	it('answers an empty listing as read rather than as failed', async () => {
		const answer = await list('[]')

		expect(answer).toEqual({ files: [], is_failed: false })
	})
})

describe('time_pull_files.list_pull_files — what it withholds', () => {
	it('reports a refused read as failed rather than as an empty diff', async () => {
		const answer = await time_pull_files.list_pull_files(PULL, async () => {
			throw new Error(REFUSAL)
		})

		expect(answer.is_failed).toBe(true)
	})

	it('reports a body that does not parse as failed — gh exits 0 on an error object', async () => {
		const answer = await list('{"message":"API rate limit exceeded"}')

		expect(answer.is_failed).toBe(true)
	})

	it('reports a row carrying no filename as failed rather than dropping it', async () => {
		const answer = await list(body([row(PATH), { additions: 1, deletions: 0 }]))

		expect(answer.is_failed).toBe(true)
	})
})

describe('time_pull_files.list_pull_files — the single page', () => {
	it('withholds a full page, which cannot be told from a truncated one', async () => {
		const rows = Array.from({ length: time_github.PAGE_SIZE }, (_unused, index) =>
			row(`scripts/file-${String(index)}.ts`),
		)
		const answer = await list(body(rows))

		expect(answer.is_failed).toBe(true)
	})

	it('reads a page one row short of the cap as whole', async () => {
		const rows = Array.from({ length: time_github.PAGE_SIZE - 1 }, (_unused, index) =>
			row(`scripts/file-${String(index)}.ts`),
		)
		const answer = await list(body(rows))

		expect(answer.is_failed).toBe(false)
		expect(answer.files).toHaveLength(time_github.PAGE_SIZE - 1)
	})
})
