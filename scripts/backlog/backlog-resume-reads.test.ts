import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { GRAPHQL_PATH } from '#scripts/gh/git-gh-pr-graphql-state'
import { run_pause_comment } from '#scripts/run/pause/run-pause-comment'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_resume_reads } from './backlog-resume-reads'

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: vi.fn() } }))

const exec_gh_api = vi.mocked(git_gh_exec.exec_gh_api)
const REPO = 'joshuafolkken/kit'
const FEW = 3
const MANY = 30
const FIRST_ISSUE = 900
const PAUSED = '901'
const LONG = '902'
const MISSING = '903'
const QUIET = '904'

interface Window {
	bodies: ReadonlyArray<string>
	has_older?: boolean
}

function issues(count: number): Array<string> {
	return Array.from({ length: count }, (_value, index) => String(FIRST_ISSUE + index))
}

function node(window: Window): unknown {
	return {
		comments: {
			pageInfo: { hasPreviousPage: window.has_older ?? false },
			nodes: window.bodies.map((body) => ({ body })),
		},
	}
}

// A child left `undefined` is one GraphQL did not answer for.
function answer(windows: ReadonlyMap<string, Window | undefined>): string {
	const repository = Object.fromEntries(
		[...windows].map(([issue, window]) => [`i${issue}`, window && node(window)]),
	)

	return JSON.stringify({ data: { repository } })
}

function quiet(list: ReadonlyArray<string>): ReadonlyMap<string, Window> {
	return new Map(list.map((issue) => [issue, { bodies: ['a comment'] }]))
}

beforeEach(() => {
	vi.restoreAllMocks()
	exec_gh_api.mockReset()
	vi.spyOn(run_pause_comment, 'is_paused').mockResolvedValue(true)
})

describe('backlog_resume_reads.open_pr_issues', () => {
	it('answers every issue of this repository the open pull requests cite, from one listing', async () => {
		exec_gh_api.mockResolvedValue(
			[
				{ body: `closes #${PAUSED}\n\ncloses #${MISSING}` },
				{ body: `follows ${REPO}#${LONG}` },
				{ body: `someone/other#${QUIET}` },
				{ body: '' },
			]
				.map((row) => JSON.stringify(row))
				.join('\n'),
		)

		expect(await backlog_resume_reads.open_pr_issues(REPO)).toEqual(
			new Set([PAUSED, MISSING, LONG]),
		)
		expect(exec_gh_api).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ path: `repos/${REPO}/pulls?state=open&per_page=100` }),
		)
	})

	it('refuses an unreadable listing row instead of reading it as no pull request', async () => {
		exec_gh_api.mockResolvedValue('invalid')

		await expect(backlog_resume_reads.open_pr_issues(REPO)).rejects.toThrow('unreadable row')
	})
})

describe('backlog_resume_reads.paused_issues — read count', () => {
	it.each([FEW, MANY])('reads %i children in one GraphQL query', async (count) => {
		const list = issues(count)

		exec_gh_api.mockResolvedValue(answer(quiet(list)))

		expect(await backlog_resume_reads.paused_issues(list, REPO)).toEqual(new Set())
		expect(exec_gh_api).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ path: GRAPHQL_PATH }),
		)
		expect(run_pause_comment.is_paused).not.toHaveBeenCalled()
	})

	it('reads nothing for no children', async () => {
		expect(await backlog_resume_reads.paused_issues([], REPO)).toEqual(new Set())
		expect(exec_gh_api).not.toHaveBeenCalled()
	})
})

describe('backlog_resume_reads.paused_issues — verdicts', () => {
	it('falls back to the paged read only where the window cannot settle it', async () => {
		const windows = new Map<string, Window | undefined>([
			[PAUSED, { bodies: [`${run_pause_comment.marker_of(PAUSED)}#1 -->`], has_older: true }],
			[LONG, { bodies: ['a comment'], has_older: true }],
			[MISSING, undefined],
			[QUIET, { bodies: [] }],
		])

		exec_gh_api.mockResolvedValue(answer(windows))

		const paused = await backlog_resume_reads.paused_issues([...windows.keys()], REPO)

		expect(paused).toEqual(new Set([PAUSED, LONG, MISSING]))
		expect(vi.mocked(run_pause_comment.is_paused).mock.calls).toEqual([[LONG], [MISSING]])
	})

	it('falls back to the paged read for every child when GraphQL refuses', async () => {
		exec_gh_api.mockRejectedValue(new Error('HTTP 403'))
		vi.mocked(run_pause_comment.is_paused).mockImplementation(async (issue) => issue === QUIET)

		expect(await backlog_resume_reads.paused_issues([PAUSED, QUIET], REPO)).toEqual(
			new Set([QUIET]),
		)
		expect(run_pause_comment.is_paused).toHaveBeenCalledTimes(2)
	})
})
