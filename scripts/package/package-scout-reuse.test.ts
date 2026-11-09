import type { JudgeRequest } from '#scripts/agent/answer-judge'
import type { AnswerVerdict } from '#scripts/agent/answer-verdict'
import type { IssueSource, SourcesRead } from '#scripts/issue/issue-sources'
import type { HoldRead } from '#scripts/run/hold/run-hold'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { package_scout_reuse, type ReuseRequest } from './package-scout-reuse'

// joshuafolkken/kit#6510: the pkg:scout half of the shared judgment — which outcome each read, verdict
// and write gives. The judgment is a fake here; `answer-judge.test.ts` covers its launch.

const { read_mock, judge_mock, comment_mock, hold_mock, worktree_mock } = vi.hoisted(() => ({
	worktree_mock: vi.fn<() => Promise<string | undefined>>(),
	read_mock: vi.fn<(issue: string) => Promise<SourcesRead>>(),
	judge_mock: vi.fn<(request: JudgeRequest) => Promise<AnswerVerdict>>(),
	comment_mock: vi.fn<(issue: string, body: string) => Promise<string>>(),
	hold_mock: vi.fn<() => HoldRead>(),
}))

vi.mock('#scripts/issue/issue-sources', () => ({ issue_sources: { read_sources: read_mock } }))
vi.mock('#scripts/agent/answer-judge', () => ({ answer_judge: { judge: judge_mock } }))
vi.mock('#scripts/gh/git-gh-command', () => ({ git_gh_command: { issue_comment: comment_mock } }))
vi.mock('#scripts/run/hold/run-hold', () => ({
	run_hold: {
		UNNUMBERED_ISSUE: 'new',
		worktree_directory: worktree_mock,
		hold_path: (directory: string): string => `${directory}/hold.json`,
		read_hold: hold_mock,
	},
}))

const ISSUE = '6510'
const RECORD_FAILED = 'record-failed'
const URL = 'https://github.com/joshuafolkken/kit/issues/6510#issuecomment-9'
const REQUEST: ReuseRequest = {
	issue: ISSUE,
	keywords: 'issue decision reuse',
	rejected: '@workflow/core',
	directory: '/lane/6510',
}
const BODY: IssueSource = {
	id: 'body',
	order: 0,
	author: undefined,
	created_at: undefined,
	text: '既存の issue_sources.read_sources を再利用する。',
}
const COMMENT: IssueSource = {
	id: 'https://github.com/joshuafolkken/kit/issues/6510#issuecomment-2',
	order: 1,
	author: 'joshuafolkken',
	created_at: '2026-11-07T00:00:00Z',
	text: '変更: scripts/issue/issue-read.ts の read_issue を再利用する。',
}

function answered(
	source: IssueSource,
	quote: string,
): Extract<AnswerVerdict, { kind: 'answered' }> {
	return {
		kind: 'answered',
		decision: `Reuse ${quote}`,
		decision_kind: 'reuse',
		evidence: [{ source, quote }],
	}
}

beforeEach(() => {
	read_mock
		.mockReset()
		.mockResolvedValue({ kind: 'sources', sources: [BODY, COMMENT], untrusted_count: 0 })
	judge_mock.mockReset().mockResolvedValue(answered(BODY, 'issue_sources.read_sources'))
	comment_mock.mockReset().mockResolvedValue(URL)
	hold_mock.mockReset().mockReturnValue({ kind: 'free' })
	worktree_mock.mockReset().mockResolvedValue('/git/6510')
})

describe('package_scout_reuse.check — a reuse the Issue decides', () => {
	it('records the Auto-decided comment with its evidence and reads as recorded', async () => {
		const outcome = await package_scout_reuse.check(REQUEST)

		expect(outcome).toMatchObject({ kind: 'recorded', url: URL })
		expect(outcome.note).toContain(
			'decides to reuse existing code (Reuse issue_sources.read_sources)',
		)

		const [issue, body] = comment_mock.mock.calls[0] ?? []

		expect(issue).toBe(ISSUE)
		expect(body).toMatch(/^Auto-decided: reuse existing code .* over adding @workflow\/core/u)
		expect(body).toContain('- body: "issue_sources.read_sources"')
	})

	it('judges the trusted sources in written order, so a later comment can change the decision', async () => {
		judge_mock.mockResolvedValue(answered(COMMENT, 'read_issue'))

		const outcome = await package_scout_reuse.check(REQUEST)

		expect(judge_mock).toHaveBeenCalledWith(
			expect.objectContaining({ sources: [BODY, COMMENT], directory: REQUEST.directory }),
		)
		expect(outcome.kind).toBe('recorded')
		expect(outcome.note).toContain('(Reuse read_issue)')
		expect(comment_mock.mock.calls[0]?.[1]).toContain(`- ${COMMENT.id}: "read_issue"`)
	})

	it('takes the target from the run held on this tree when --issue is absent', async () => {
		hold_mock.mockReturnValue({
			kind: 'held',
			hold: { issue: ISSUE, taken_at: '2026-11-10T00:00:00Z', pid: 1 },
		})

		await package_scout_reuse.check({ ...REQUEST, issue: undefined })

		expect(read_mock).toHaveBeenCalledWith(ISSUE)
	})
})

// The earlier record a re-run finds on the Issue, written by an earlier `check` for `keywords`.
function prior_record(keywords: string): IssueSource {
	const text = [
		'Auto-decided: reuse existing code (x) over adding y because this Issue decides it —',
		`\`pkg:scout ${keywords}\` ranked a close pair, so no dependency is added (Tier A).`,
	].join(' ')

	return { ...COMMENT, id: URL, text }
}

describe('package_scout_reuse.check — a re-run on an Issue it already recorded', () => {
	it('settles on the earlier Auto-decided comment, with no second judgment or comment', async () => {
		const sources = [BODY, prior_record(REQUEST.keywords)]

		read_mock.mockResolvedValue({ kind: 'sources', sources, untrusted_count: 0 })

		const outcome = await package_scout_reuse.check(REQUEST)

		expect(outcome).toMatchObject({ kind: 'recorded', url: URL })
		expect(judge_mock).not.toHaveBeenCalled()
		expect(comment_mock).not.toHaveBeenCalled()
	})

	it('judges again when a later comment follows the record, so a reversal reads as undecided', async () => {
		const reversal: IssueSource = {
			...COMMENT,
			order: 2,
			text: '再利用しない。パッケージを追加する。',
		}
		const sources = [BODY, prior_record(REQUEST.keywords), reversal]

		read_mock.mockResolvedValue({ kind: 'sources', sources, untrusted_count: 0 })
		judge_mock.mockResolvedValue({ kind: 'unanswered', reason: 'reversed' })

		const outcome = await package_scout_reuse.check(REQUEST)

		expect(judge_mock).toHaveBeenCalledOnce()
		expect(outcome.kind).toBe('undecided')
		expect(comment_mock).not.toHaveBeenCalled()
	})

	it('judges again when the earlier Auto-decided comment names other keywords', async () => {
		const sources = [BODY, prior_record('other')]

		read_mock.mockResolvedValue({ kind: 'sources', sources, untrusted_count: 0 })

		await package_scout_reuse.check(REQUEST)

		expect(judge_mock).toHaveBeenCalledOnce()
		expect(comment_mock).toHaveBeenCalledOnce()
	})
})

describe('package_scout_reuse.check — no decision keeps the question', () => {
	it.each<[string, AnswerVerdict]>([
		['an unanswered verdict', { kind: 'unanswered', reason: 'only background' }],
		['a choice that is not a reuse', { ...answered(BODY, 'x'), decision_kind: 'choice' }],
	])('reads %s as undecided and writes nothing', async (_label, verdict) => {
		judge_mock.mockResolvedValue(verdict)

		const outcome = await package_scout_reuse.check(REQUEST)

		expect(outcome.kind).toBe('undecided')
		expect(package_scout_reuse.is_failure(outcome)).toBe(false)
		expect(comment_mock).not.toHaveBeenCalled()
	})
})

describe('package_scout_reuse.check — each stop is its own outcome', () => {
	it.each<[string, HoldRead]>([
		['no run held', { kind: 'free' }],
		['an unnumbered run', { kind: 'held', hold: { issue: 'new', taken_at: '', pid: 1 } }],
	])('reads %s with no --issue as an unknown target', async (_label, hold) => {
		hold_mock.mockReturnValue(hold)

		const outcome = await package_scout_reuse.check({ ...REQUEST, issue: undefined })

		expect(outcome.kind).toBe('unknown')
		expect(package_scout_reuse.is_failure(outcome)).toBe(false)
		expect(read_mock).not.toHaveBeenCalled()
	})

	it('reads a failed work-tree lookup with no --issue as an unknown target, not a throw', async () => {
		worktree_mock.mockRejectedValue(new Error('not a git repository'))

		const outcome = await package_scout_reuse.check({ ...REQUEST, issue: undefined })

		expect(outcome.kind).toBe('unknown')
		expect(read_mock).not.toHaveBeenCalled()
	})

	it('reads an Issue that could not be fetched as unreadable, before any judgment', async () => {
		read_mock.mockResolvedValue({ kind: 'unreadable', is_retryable: true, hint: 'gh auth' })

		const outcome = await package_scout_reuse.check(REQUEST)

		expect(outcome.kind).toBe('unreadable')
		expect(outcome.note).toContain('could not be read (unreadable — gh auth)')
		expect(judge_mock).not.toHaveBeenCalled()
	})
})

describe('package_scout_reuse.check — a stopped judgment or write is never recorded', () => {
	it('reads a failed judgment as failed, with its retry', async () => {
		judge_mock.mockResolvedValue({ kind: 'failed', cause: 'no JSON', retry: 'Re-run it.' })

		const outcome = await package_scout_reuse.check(REQUEST)

		expect(outcome.kind).toBe('failed')
		expect(outcome.note).toContain('failed (no JSON). Re-run it.')
		expect(comment_mock).not.toHaveBeenCalled()
	})

	it('reads a refused comment as record-failed, never as recorded', async () => {
		comment_mock.mockRejectedValue(new Error('HTTP 403'))

		const outcome = await package_scout_reuse.check(REQUEST)

		expect(outcome.kind).toBe(RECORD_FAILED)
		expect(outcome.note).toContain('HTTP 403')
	})

	it.each(['unreadable', 'failed', RECORD_FAILED] as const)('counts %s as a failure', (kind) => {
		expect(package_scout_reuse.is_failure({ kind, note: '' })).toBe(true)
	})
})
