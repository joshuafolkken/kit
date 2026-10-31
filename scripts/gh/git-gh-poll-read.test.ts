import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FULL_PAGE_QUERY } from './git-gh-api-path'
import { git_gh_conditional, type ConditionalRead } from './git-gh-conditional'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_poll_read } from './git-gh-poll-read'
import { check_runs_pages, PR_HEAD_SHA, REPO_NAME_PATH } from './git-gh-pr-fixture'
import { git_gh_pr_rollup } from './git-gh-pr-rollup'

// joshuafolkken/kit#4550: every lane waiting on its merge repeatedly read its pull request, and each
// read counted against the rate limit whether or not anything had changed.

const PATH = `${REPO_NAME_PATH}/pulls/972`
const LISTING_PATH = `${REPO_NAME_PATH}/commits/${PR_HEAD_SHA}/check-runs`
const ETAG = 'W/"abc"'
const RUNNING = { name: 'SonarQube', status: 'in_progress' }
const PAGE = JSON.stringify({ total_count: 1, check_runs: [RUNNING] })
const LONG_PAGE = JSON.stringify({ total_count: 101, check_runs: [RUNNING] })
const UNCHANGED: ConditionalRead = { kind: 'unchanged' }

function changed(body: string): ConditionalRead {
	return { kind: 'changed', etag: ETAG, body }
}

function rollup(check_runs_json: string): Array<object> {
	return git_gh_pr_rollup.to_status_check_rollup({ check_runs_json, status_json: '[]' })
}

function answer(...reads: ReadonlyArray<ConditionalRead>): void {
	const mocked = vi.spyOn(git_gh_conditional, 'read_conditional')

	for (const read of reads) mocked.mockResolvedValueOnce(read)
}

beforeEach(() => {
	git_gh_poll_read.forget_poll_reads()
	vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(check_runs_pages([RUNNING]))
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('git_gh_poll_read.read', () => {
	it('sends the ETag of the previous answer and reuses its body on a 304', async () => {
		answer(changed(PAGE), UNCHANGED)

		expect(await git_gh_poll_read.read(PATH)).toBe(PAGE)
		expect(await git_gh_poll_read.read(PATH)).toBe(PAGE)
		expect(git_gh_conditional.read_conditional).toHaveBeenLastCalledWith(PATH, ETAG)
	})

	it('sends no ETag on the first read', async () => {
		answer(changed(PAGE))
		await git_gh_poll_read.read(PATH)

		expect(git_gh_conditional.read_conditional).toHaveBeenCalledExactlyOnceWith(PATH, undefined)
	})

	it('throws where the read failed rather than answering an empty body', async () => {
		answer({ kind: 'unreadable' })

		await expect(git_gh_poll_read.read(PATH)).rejects.toThrow(
			git_gh_poll_read.UNREADABLE_POLL_MESSAGE,
		)
	})

	it('chains gh failure as the cause of the one it throws', async () => {
		const cause = new Error('HTTP 502')

		answer({ kind: 'unreadable', cause })

		await expect(git_gh_poll_read.read(PATH)).rejects.toHaveProperty('cause', cause)
	})

	// The poll loop's warning prints `String(error)`, which drops the cause.
	it('names gh failure in the message of the one it throws', async () => {
		answer({ kind: 'unreadable', cause: new Error('HTTP 502') })

		await expect(git_gh_poll_read.read(PATH)).rejects.toThrow(`${PATH}: HTTP 502`)
	})
})

describe('git_gh_poll_read.read_object_pages', () => {
	it('answers a listing that fits one page in the slurped shape, without paging', async () => {
		answer(changed(PAGE))

		expect(await git_gh_poll_read.read_object_pages(LISTING_PATH)).toBe(`[${PAGE}]`)
		expect(git_gh_conditional.read_conditional).toHaveBeenCalledWith(
			`${LISTING_PATH}${FULL_PAGE_QUERY}`,
			undefined,
		)
		expect(git_gh_exec.exec_gh_api).not.toHaveBeenCalled()
	})

	it('pages through a listing longer than one page', async () => {
		answer(changed(LONG_PAGE))
		await git_gh_poll_read.read_object_pages(LISTING_PATH)

		expect(git_gh_exec.exec_gh_api).toHaveBeenCalledExactlyOnceWith({
			path: `${LISTING_PATH}${FULL_PAGE_QUERY}`,
			should_paginate: true,
			should_slurp: true,
		})
	})

	// The verdict a poll reaches from the reused body is the one the first read reached.
	it('keeps the rollup unchanged across a 304', async () => {
		answer(changed(PAGE), UNCHANGED)
		const first = await git_gh_poll_read.read_object_pages(LISTING_PATH)
		const second = await git_gh_poll_read.read_object_pages(LISTING_PATH)

		expect(rollup(second)).toStrictEqual(rollup(first))
	})
})
