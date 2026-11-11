import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_gh_pr_snapshot } from '#scripts/gh/git-gh-pr-snapshot'
import type { PrStateSnapshot } from '#scripts/gh/git-pr-checks-parse'
import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { issue_watch_diff, type WatchComment } from '#scripts/issue/issue-watch-diff'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_pr_return } from './run-pr-return'

// joshuafolkken/kit#7313: a pull request dispatched back for a fix resumed at the gate, read neither its
// red checks nor the comment asking for the fix, and shipped unfixed.

const PERSON = 'joshuafolkken'
const RUN_BODY = `Plan posted.\n\n${issue_watch_diff.RUN_MARKER}`
const FIX_BODY = 'CI is red: fix the publish step.'
const REQUIRED = 'CI'

function comment(id: number, body: string, overrides: Partial<WatchComment> = {}): WatchComment {
	const is_automated = body.includes(issue_watch_diff.RUN_MARKER)

	return {
		id,
		author: PERSON,
		is_trusted: true,
		is_automated,
		created_at: `2026-11-11T0${String(id)}:00:00Z`,
		body,
		...overrides,
	}
}

function snapshot(rollup: PrStateSnapshot['rollup']): PrStateSnapshot {
	return {
		rollup,
		merge_state_status: 'BLOCKED',
		review_decision: undefined,
		required_contexts: [REQUIRED],
	}
}

describe('run_pr_return.red_required_checks', () => {
	it('names a failed required check, its suite jobs included', () => {
		const read = snapshot([
			{ name: 'CI / test', status: 'fail' },
			{ name: 'CI / lint', status: 'pass' },
		])

		expect(run_pr_return.red_required_checks(read)).toStrictEqual(['CI / test'])
	})

	it('leaves out a failed optional check and a required one still running', () => {
		const read = snapshot([
			{ name: 'CodeRabbit', status: 'fail' },
			{ name: REQUIRED, status: 'pending' },
		])

		expect(run_pr_return.red_required_checks(read)).toStrictEqual([])
	})
})

describe('run_pr_return.comments_since', () => {
	const SINCE_MS = Date.parse('2026-11-11T02:00:00Z')

	it("keeps a person's comment after the run's last commit, marked by josh or not", () => {
		const plain = comment(3, FIX_BODY)
		const marked = comment(4, RUN_BODY, { is_automated: true })
		const comments = [comment(1, FIX_BODY), comment(2, FIX_BODY), plain, marked]

		expect(run_pr_return.comments_since(comments, SINCE_MS)).toStrictEqual([plain, marked])
	})

	it('keeps nothing written before the commit, or by an outsider or a bot since', () => {
		const outsider = comment(3, FIX_BODY, { is_trusted: false })
		const bot = comment(4, FIX_BODY, { author: 'coderabbitai[bot]' })

		expect(run_pr_return.comments_since([comment(1, FIX_BODY)], SINCE_MS)).toStrictEqual([])
		expect(run_pr_return.comments_since([outsider, bot], SINCE_MS)).toStrictEqual([])
	})
})

describe('run_pr_return.format', () => {
	it('prints nothing for a pull request nothing returned', () => {
		expect(run_pr_return.format({ red_checks: [], comments: [] })).toBeUndefined()
	})

	it('names each red check and each comment to read', () => {
		const text = run_pr_return.format({
			red_checks: ['CI / test'],
			comments: [comment(3, FIX_BODY)],
		})

		expect(text).toContain('red required check: CI / test')
		expect(text).toContain(`read the comment by ${PERSON} at 2026-11-11T03:00:00Z`)
	})
})

const BRANCH = '7313-lane'
const LAST_COMMIT = ['log', '--first-parent', '--no-merges', '-1', '--format=%cI']
const RED = { __typename: 'CheckRun', name: REQUIRED, status: 'COMPLETED', conclusion: 'FAILURE' }
const RAW = JSON.stringify({ statusCheckRollup: [RED], requiredContexts: [REQUIRED] })

describe('run_pr_return.read', () => {
	beforeEach(() => {
		vi.spyOn(git_command, 'branch').mockResolvedValue(BRANCH)
		vi.spyOn(git_spawn, 'read').mockResolvedValue('2026-11-11T01:30:00Z')
	})

	it('reads the red required checks of the branch and the comments since the last commit', async () => {
		const snapshot_spy = vi
			.spyOn(git_gh_pr_snapshot, 'pr_get_state_snapshot')
			.mockResolvedValue(RAW)

		vi.spyOn(git_gh_issue_read, 'issue_list_comments').mockResolvedValue('[]')
		vi.spyOn(issue_watch_diff, 'parse_comments').mockResolvedValue([
			comment(1, FIX_BODY),
			comment(2, RUN_BODY),
		])

		const read = await run_pr_return.read('7313')

		expect(snapshot_spy).toHaveBeenCalledExactlyOnceWith(BRANCH)
		expect(read.red_checks).toStrictEqual([REQUIRED])
		expect(read.comments.map((item) => item.id)).toStrictEqual([2])
	})

	it("asks for the issue's comments and the newest non-merge commit on the first-parent line", async () => {
		const list_spy = vi.spyOn(git_gh_issue_read, 'issue_list_comments').mockResolvedValue('[]')

		vi.spyOn(git_gh_pr_snapshot, 'pr_get_state_snapshot').mockResolvedValue('{}')
		await run_pr_return.read('7313')

		expect(list_spy).toHaveBeenCalledExactlyOnceWith('7313')
		expect(git_spawn.read).toHaveBeenCalledExactlyOnceWith(LAST_COMMIT)
	})

	it('counts a comment listing that cannot be read as none', async () => {
		vi.spyOn(git_gh_pr_snapshot, 'pr_get_state_snapshot').mockResolvedValue('{}')
		vi.spyOn(git_gh_issue_read, 'issue_list_comments').mockResolvedValue(undefined)
		vi.spyOn(issue_watch_diff, 'parse_comments').mockResolvedValue(undefined)

		expect(await run_pr_return.read('7313')).toStrictEqual({ red_checks: [], comments: [] })
	})
})
