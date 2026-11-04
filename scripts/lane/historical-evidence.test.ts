import { plan_consumers_section } from '#scripts/issue/plan-consumers-section'
import { review_comment_round } from '#scripts/review/review-comment-round'
import { beforeEach, expect, it, vi } from 'vitest'
import { historical_evidence } from './historical-evidence'

const mocks = vi.hoisted(() => ({ comments: vi.fn(), pull: vi.fn(), api: vi.fn(), logs: vi.fn() }))

vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_list_comments: mocks.comments },
}))
vi.mock('#scripts/gh/git-gh-pr-read', () => ({ read_pull: mocks.pull }))
vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: mocks.api } }))
vi.mock('./historical-log-evidence', () => ({ historical_log_evidence: { read: mocks.logs } }))

const ISSUE = 6301
const PR = 6310
const AT = '2026-11-04T11:00:00Z'
const LATER = '2026-11-04T12:00:00Z'
const URL = 'https://github.com/owner/repo/issues/6301#issuecomment-1'
const PR_URL = 'https://github.com/owner/repo/pull/6310'
const COMMIT_URL = 'https://github.com/owner/repo/commit/abc'
const PLAN = `## Plan\n${plan_consumers_section.HEADING}\n- None`
const REVIEW = review_comment_round.body_of([])
const HANDOFF = '## Handoff\nContinue the implementation.'
const COMMITS_PATH = 'repos/{owner}/{repo}/pulls/6310/commits?per_page=100'

function comment(body: string, created_at = AT): object {
	return { body, created_at, html_url: URL, author_association: 'OWNER' }
}

function commit(date: string = AT): object {
	return { html_url: COMMIT_URL, commit: { committer: { date } } }
}

beforeEach(() => {
	vi.resetAllMocks()
	mocks.comments.mockResolvedValue('[]')
	mocks.pull.mockResolvedValue({
		number: PR,
		body: `closes #${String(ISSUE)}`,
		merged_at: LATER,
		html_url: PR_URL,
	})
	mocks.api.mockResolvedValue('[]')
	mocks.logs.mockResolvedValue({ evidence: [], unreadable: [] })
})

it('collects comment timestamps and their sources (ac-3622d61b)', async () => {
	mocks.comments.mockResolvedValue(
		JSON.stringify([comment(PLAN), comment(HANDOFF), comment(REVIEW)]),
	)

	const result = await historical_evidence.read({ issue: ISSUE })

	expect(result).toEqual({
		evidence: ['plan', 'handoff', 'review-record'].map((kind) => ({ kind, at: AT, source: URL })),
		unreadable: [],
	})
	expect(mocks.comments).toHaveBeenCalledWith(String(ISSUE))
})

it('requests every PR commit page and keeps merge and commit sources (ac-3622d61b)', async () => {
	mocks.api.mockResolvedValue(JSON.stringify([commit()]))

	const result = await historical_evidence.read({ issue: ISSUE, pr_number: PR })

	expect(mocks.api).toHaveBeenCalledWith({
		path: COMMITS_PATH,
		should_paginate: true,
	})
	expect(result.evidence).toEqual([
		{ kind: 'commit', at: AT, source: COMMIT_URL },
		{ kind: 'merge', at: LATER, source: PR_URL },
	])
})

it('ignores unrelated, untrusted, undated and sourceless comments (ac-faea0c1f)', async () => {
	mocks.comments.mockResolvedValue(
		JSON.stringify([
			comment('ordinary discussion'),
			comment(PLAN, 'invalid'),
			{ ...comment(PLAN), author_association: 'NONE' },
			{ ...comment(PLAN), html_url: undefined },
		]),
	)

	const result = await historical_evidence.read({ issue: ISSUE })

	expect(result.evidence).toEqual([])
})

it('rejects a PR that closes another issue without reading its commits (ac-faea0c1f)', async () => {
	mocks.pull.mockResolvedValue({ body: 'closes #1', merged_at: AT, html_url: PR_URL })

	const result = await historical_evidence.read({ issue: ISSUE, pr_number: PR })

	expect(result).toEqual({ evidence: [], unreadable: ['pull does not close this issue'] })
	expect(mocks.api).not.toHaveBeenCalled()
})

it.each([undefined, 'invalid', '{}'])(
	'reports unreadable comments: %s (ac-faea0c1f)',
	async (raw) => {
		mocks.comments.mockResolvedValue(raw)

		const result = await historical_evidence.read({ issue: ISSUE })

		expect(result.unreadable).toEqual(['comments'])
	},
)

it('preserves independent evidence when GitHub or local lookup fails (ac-c9e052fb)', async () => {
	mocks.comments.mockResolvedValue(JSON.stringify([comment(PLAN)]))
	mocks.pull.mockRejectedValue(new Error('offline'))
	mocks.logs.mockRejectedValue(new Error('no checkout'))

	const result = await historical_evidence.read({ issue: ISSUE, pr_number: PR })

	expect(result.evidence).toEqual([{ kind: 'plan', at: AT, source: URL }])
	expect(result.unreadable).toEqual(['pull', 'logs'])
})

it.each(['invalid', '{}'])('reports a malformed commit response: %s (ac-faea0c1f)', async (raw) => {
	mocks.api.mockResolvedValue(raw)

	const result = await historical_evidence.read({ issue: ISSUE, pr_number: PR })

	expect(result.unreadable).toEqual(['pull'])
})

it('excludes invalid and missing commit or merge timestamps (ac-faea0c1f)', async () => {
	mocks.pull.mockResolvedValue({
		body: `closes #${String(ISSUE)}`,
		merged_at: 'bad',
		html_url: PR_URL,
	})
	mocks.api.mockResolvedValue(JSON.stringify([commit('bad'), { html_url: COMMIT_URL, commit: {} }]))

	const result = await historical_evidence.read({ issue: ISSUE, pr_number: PR })

	expect(result.evidence).toEqual([])
})
