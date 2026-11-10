import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_transport } from '#scripts/gh/git-gh-transport'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_issue_count } from './run-board-issue-count'

// joshuafolkken/kit#7088: the repository's open and closed issues at the end of `run:board`'s first
// line, read off GraphQL's `issues`, which holds no pull request.

const { count_of, part_of, read_issue_count } = run_board_issue_count
const REPO = 'joshuafolkken/kit'

afterEach(() => {
	vi.restoreAllMocks()
})

function answer(open: number, closed: number): string {
	return JSON.stringify({
		data: { repository: { open: { totalCount: open }, closed: { totalCount: closed } } },
	})
}

// A `search/issues` page whose total is 87 for the open query and 6,912 for the closed one.
function search_answer(path: string): string {
	const query = new URLSearchParams(path.split('?', 2)[1]).get('q') ?? ''

	return JSON.stringify({ total_count: query.endsWith('is:open') ? 87 : 6912 })
}

describe('run_board_issue_count.part_of', () => {
	it('draws the open and closed counts with thousands separated', () => {
		expect(part_of(REPO, { open: 87, closed: 6912 }, String)).toBe('📮 87/6,912')
	})

	it('separates the open count too once it passes a thousand', () => {
		expect(part_of(REPO, { open: 1234, closed: 1_234_567 }, String)).toBe('📮 1,234/1,234,567')
	})

	it('draws nothing where no count was read', () => {
		expect(part_of(REPO, undefined, String)).toBeUndefined()
	})

	it('draws nothing before a plan names the repository', () => {
		expect(part_of(undefined, { open: 87, closed: 6912 }, String)).toBeUndefined()
	})
})

describe('run_board_issue_count.count_of', () => {
	it('reads the open and closed totals off the answer', () => {
		expect(count_of(answer(87, 6912))).toStrictEqual({ open: 87, closed: 6912 })
	})

	it.each([undefined, '{not json', '{"data":{"repository":null}}', '{"errors":[]}'])(
		'answers no count for %s',
		(text) => {
			expect(count_of(text)).toBeUndefined()
		},
	)
})

describe('run_board_issue_count.read_issue_count', () => {
	it('reads the count through GraphQL and spends no REST search', async () => {
		vi.spyOn(git_gh_transport, 'query').mockResolvedValue(answer(87, 6912))
		const rest = vi.spyOn(git_gh_exec, 'exec_gh_api')

		await expect(read_issue_count(REPO)).resolves.toStrictEqual({ open: 87, closed: 6912 })
		expect(rest).not.toHaveBeenCalled()
	})

	it('counts through search/issues on a REST session', async () => {
		vi.spyOn(git_gh_transport, 'query').mockResolvedValue(undefined)
		const rest = vi
			.spyOn(git_gh_exec, 'exec_gh_api')
			.mockImplementation(async ({ path }) => search_answer(path))

		await expect(read_issue_count(REPO)).resolves.toStrictEqual({ open: 87, closed: 6912 })
		expect(rest).toHaveBeenCalledTimes(2)
	})

	it('answers no count where a REST search fails', async () => {
		vi.spyOn(git_gh_transport, 'query').mockResolvedValue(undefined)
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockRejectedValue(new Error('HTTP 403'))

		await expect(read_issue_count(REPO)).resolves.toBeUndefined()
	})

	it('answers no count for a repository that cannot be spelled', async () => {
		const query = vi.spyOn(git_gh_transport, 'query')

		await expect(read_issue_count('not-a-repo')).resolves.toBeUndefined()
		expect(query).not.toHaveBeenCalled()
	})
})

describe('run_board_cli.LIVE_PORTS issue count', () => {
	it('reads the count of the repository the plan names', async () => {
		const read = vi
			.spyOn(run_board_issue_count, 'read_issue_count')
			.mockResolvedValue({ open: 87, closed: 6912 })

		await expect(run_board_cli.LIVE_PORTS.read_issue_count?.(REPO)).resolves.toStrictEqual({
			open: 87,
			closed: 6912,
		})
		expect(read).toHaveBeenCalledWith(REPO)
	})
})
