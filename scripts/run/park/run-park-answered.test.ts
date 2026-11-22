import type { JudgeRequest } from '#scripts/agent/answer-judge'
import type { AnswerVerdict } from '#scripts/agent/answer-verdict'
import type { IssueSource, SourcesRead } from '#scripts/issue/issue-sources'
import { session_language } from '#scripts/josh/session-language'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_park_answered } from './run-park-answered'

// joshuafolkken/kit#6531: the park's half of the shared judgment — what it prints and returns for each
// verdict. The judgment itself is a fake here; `answer-judge.test.ts` covers its launch.

const { read_mock, judge_mock } = vi.hoisted(() => ({
	read_mock: vi.fn<(issue: string) => Promise<SourcesRead>>(),
	judge_mock: vi.fn<(request: JudgeRequest) => Promise<AnswerVerdict>>(),
}))

vi.mock('#scripts/issue/issue-sources', () => ({ issue_sources: { read_sources: read_mock } }))
vi.mock('#scripts/agent/answer-judge', () => ({ answer_judge: { judge: judge_mock } }))

const ISSUE = '6531'
const DIRECTORY = '/lane/6531'
const QUESTION = '## Which source does the judgment read?'
const COMMENT: IssueSource = {
	id: 'https://github.com/joshuafolkken/kit/issues/6531#issuecomment-2',
	order: 1,
	author: 'joshuafolkken',
	created_at: '2026-11-07T00:00:00Z',
	text: '変更: 判定は issue_sources を再利用する。',
}
const QUOTE = '判定は issue_sources を再利用する'
const ANSWERED: AnswerVerdict = {
	kind: 'answered',
	decision: 'Reuse issue_sources',
	decision_kind: 'reuse',
	evidence: [{ source: COMMENT, quote: QUOTE }],
}
const NO_WRITE = 'Nothing was labelled, commented, recorded or released.'

function printed(): string {
	return vi
		.mocked(console.error)
		.mock.calls.map((call) => String(call[0]))
		.join('\n')
}

beforeEach(() => {
	read_mock
		.mockReset()
		.mockResolvedValue({ kind: 'sources', sources: [COMMENT], untrusted_count: 0 })
	judge_mock.mockReset().mockResolvedValue({ kind: 'unanswered', reason: 'not decided' })
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('run_park_answered.refusal_of', () => {
	it.each([
		['ja', '答え済みかの判断を省きました'],
		['en', 'existing-answer check was skipped'],
	])('annotates an unavailable judgment in %s', async (lang, expected) => {
		vi.stubEnv(session_language.ENV_KEY, lang)
		const cause = 'usage limit: log'

		judge_mock.mockResolvedValue({ kind: 'unavailable', cause, retry: 'Retry' })

		const note = await run_park_answered.refusal_of(ISSUE, QUESTION, DIRECTORY)

		expect(note).toEqual({ note: expect.stringContaining(expected) })
		expect(note).toEqual({ note: expect.stringContaining(cause) })
		expect(console.error).not.toHaveBeenCalled()
		vi.unstubAllEnvs()
	})

	it('lets an unanswered question park, judging it on the trusted sources', async () => {
		await expect(run_park_answered.refusal_of(ISSUE, QUESTION, DIRECTORY)).resolves.toBeUndefined()
		expect(judge_mock).toHaveBeenCalledWith({
			question: QUESTION,
			sources: [COMMENT],
			directory: DIRECTORY,
		})
		expect(console.error).not.toHaveBeenCalled()
	})

	it('refuses an answered question, printing the quote with its source and origin', async () => {
		judge_mock.mockResolvedValue(ANSWERED)

		await expect(run_park_answered.refusal_of(ISSUE, QUESTION, DIRECTORY)).resolves.toEqual({
			exit_code: 1,
		})
		expect(printed()).toContain('already answers this question — Reuse issue_sources (reuse)')
		expect(printed()).toContain(`- ${COMMENT.id} (joshuafolkken 2026-11-07T00:00:00Z): "${QUOTE}"`)
		expect(printed()).toContain('Auto-decided')
		expect(printed()).toContain(NO_WRITE)
	})
})

// joshuafolkken/kit#8726: the #8655 shape — the Issue decided on a follow-up filing only the parent can do.
function park_body(permission: string): string {
	return [
		'## Close #8655 as near the boundary, or file the follow-up?',
		'### 選択肢',
		'1. File the follow-up with needs-decision, then close #8655',
		'   - 層: A',
		`   - 必要な権限: ${permission}`,
		'2. Close #8655 as near the boundary',
		'   - 層: A',
		'   - 必要な権限: 親（issue:close）',
		'### 推奨',
		'1 the decision rule chose a follow-up Issue',
	].join('\n')
}

describe('run_park_answered.refusal_of a recommendation by permission', () => {
	it.each([
		['ja', 'Issue はこの問いに答え済みです（Reuse issue_sources）'],
		['en', 'The Issue already answers this question (Reuse issue_sources)'],
	])(
		"parks an answered question whose pick is the parent's filing, noting the decision in %s (ac-ad90d0c5)",
		async (lang, expected) => {
			vi.stubEnv(session_language.ENV_KEY, lang)
			judge_mock.mockResolvedValue(ANSWERED)

			await expect(
				run_park_answered.refusal_of(ISSUE, park_body('親（issue:file …）'), DIRECTORY),
			).resolves.toEqual({ note: expect.stringContaining(expected) })
			expect(console.error).not.toHaveBeenCalled()
			vi.unstubAllEnvs()
		},
	)

	it('still refuses an answered question whose pick the child can run (ac-0a784e00)', async () => {
		judge_mock.mockResolvedValue(ANSWERED)

		await expect(
			run_park_answered.refusal_of(ISSUE, park_body('なし'), DIRECTORY),
		).resolves.toEqual({ exit_code: 1 })
		expect(printed()).toContain('already answers this question')
	})
})

describe('run_park_answered.refusal_of failures', () => {
	it('refuses a failed judgment with its cause and retry, before any write', async () => {
		judge_mock.mockResolvedValue({
			kind: 'failed',
			cause: 'the judgment exited 2',
			retry: 'Re-run',
		})

		await expect(run_park_answered.refusal_of(ISSUE, QUESTION, DIRECTORY)).resolves.toEqual({
			exit_code: 1,
		})
		expect(printed()).toContain(`Park failed: the judgment exited 2. ${NO_WRITE}`)
		expect(printed()).toContain(
			`Retry: Re-run (\`pnpm josh run:park ${ISSUE} --body-file <path> --outcome "<next action>"\`)`,
		)
	})

	it.each([
		[
			{ kind: 'comments-unreadable', is_retryable: true, hint: 'gh: 502' },
			'comments-unreadable — gh: 502',
		],
		[{ kind: 'trust-unknown', is_retryable: true }, 'once the Issue reads again'],
		[{ kind: 'missing', is_retryable: false }, 'check the number'],
	] as const)('refuses an unread Issue %j without judging', async (read, expected) => {
		read_mock.mockResolvedValue(read)

		await expect(run_park_answered.refusal_of(ISSUE, QUESTION, DIRECTORY)).resolves.toEqual({
			exit_code: 1,
		})
		expect(judge_mock).not.toHaveBeenCalled()
		expect(printed()).toContain(expected)
	})
})
