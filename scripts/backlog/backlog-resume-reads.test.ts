import { git_gh_conditional } from '#scripts/gh/git-gh-conditional'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { GRAPHQL_PATH } from '#scripts/gh/git-gh-pr-graphql-state'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { run_pause_comment } from '#scripts/run/pause/run-pause-comment'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_resume_reads } from './backlog-resume-reads'

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: vi.fn() } }))
vi.mock('#scripts/gh/git-gh-conditional', () => ({
	git_gh_conditional: { read_conditional: vi.fn() },
}))

const exec_gh_api = vi.mocked(git_gh_exec.exec_gh_api)
const read_conditional = vi.mocked(git_gh_conditional.read_conditional)
const REPO = 'joshuafolkken/kit'
const OPEN_PULLS_PATH = `repos/${REPO}/pulls?state=open&per_page=100`
const LISTING_ETAG = 'W/"pulls"'
const FULL_PAGE = 100
const FEW = 3
const MANY = 30
const FIRST_ISSUE = 900
const PAUSED = '901'
const LONG = '902'
const MISSING = '903'
const QUIET = '904'
// REST answers `null` for a pull request opened with no description.
const NULL_BODY: unknown = JSON.parse('{"body":null}')
const CITING_PULLS = [
	{ body: `closes #${PAUSED}\n\ncloses #${MISSING}` },
	{ body: `follows ${REPO}#${LONG}` },
	{ body: `someone/other#${QUIET}` },
	NULL_BODY,
]
const CITED = new Set([PAUSED, MISSING, LONG])

function answer_listing(rows: ReadonlyArray<unknown>): void {
	read_conditional.mockResolvedValue({
		kind: 'changed',
		etag: LISTING_ETAG,
		body: JSON.stringify(rows),
	})
}

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
	read_conditional.mockReset()
	shared_cache_fixture.keep_in_memory()
	vi.spyOn(run_pause_comment, 'is_paused').mockResolvedValue(true)
})

describe('backlog_resume_reads.open_pr_issues', () => {
	it('answers every issue of this repository the open pull requests cite, from one listing', async () => {
		answer_listing(CITING_PULLS)

		expect(await backlog_resume_reads.open_pr_issues(REPO)).toEqual(CITED)
		expect(read_conditional).toHaveBeenCalledExactlyOnceWith(OPEN_PULLS_PATH, undefined, undefined)
		expect(exec_gh_api).not.toHaveBeenCalled()
	})

	it('answers the same issues from the kept listing when the second read is a 304', async () => {
		answer_listing(CITING_PULLS)
		await backlog_resume_reads.open_pr_issues(REPO)
		read_conditional.mockResolvedValue({ kind: 'unchanged' })

		expect(await backlog_resume_reads.open_pr_issues(REPO)).toEqual(CITED)
		expect(read_conditional).toHaveBeenLastCalledWith(OPEN_PULLS_PATH, LISTING_ETAG, undefined)
	})

	it('falls back to the paged read on a full first page, parsed the same way', async () => {
		const full_page = Array.from({ length: FULL_PAGE }, () => NULL_BODY)

		answer_listing(full_page)
		exec_gh_api.mockResolvedValue(JSON.stringify([...full_page, ...CITING_PULLS]))

		expect(await backlog_resume_reads.open_pr_issues(REPO)).toEqual(CITED)
		expect(exec_gh_api).toHaveBeenCalledExactlyOnceWith({
			path: OPEN_PULLS_PATH,
			should_paginate: true,
		})
	})

	it.each(['invalid', JSON.stringify([{ title: 'no body' }])])(
		'refuses an unreadable listing %s instead of reading it as no pull request',
		async (body) => {
			read_conditional.mockResolvedValue({ kind: 'changed', etag: LISTING_ETAG, body })

			await expect(backlog_resume_reads.open_pr_issues(REPO)).rejects.toThrow('unreadable row')
		},
	)
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
