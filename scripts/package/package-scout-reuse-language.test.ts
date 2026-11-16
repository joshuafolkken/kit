import type { AnswerVerdict } from '#scripts/agent/answer-verdict'
import type { IssueSource, SourcesRead } from '#scripts/issue/issue-sources'
import { session_language } from '#scripts/josh/session-language'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { package_scout_reuse, type ReuseRequest } from './package-scout-reuse'

// joshuafolkken/kit#7670: only the reason after `because` and the evidence label follow
// `JOSH_SESSION_LANG`; the `Auto-decided:` skeleton and the scout mark a re-run matches stay English.

const { read_mock, judge_mock, comment_mock } = vi.hoisted(() => ({
	read_mock: vi.fn<(issue: string) => Promise<SourcesRead>>(),
	judge_mock: vi.fn<() => Promise<AnswerVerdict>>(),
	comment_mock: vi.fn<(issue: string, body: string) => Promise<string>>(),
}))

vi.mock('#scripts/issue/issue-sources', () => ({ issue_sources: { read_sources: read_mock } }))
vi.mock('#scripts/agent/answer-judge', () => ({ answer_judge: { judge: judge_mock } }))
vi.mock('#scripts/gh/git-gh-command', () => ({ git_gh_command: { issue_comment: comment_mock } }))

const URL = 'https://github.com/joshuafolkken/kit/issues/7670#issuecomment-1'
const REQUEST: ReuseRequest = {
	issue: '7670',
	keywords: 'session prose',
	rejected: 'i18next',
	directory: '/lane/7670',
}
const BODY: IssueSource = {
	id: 'body',
	order: 0,
	author: undefined,
	created_at: undefined,
	text: '既存の session_language を再利用する。',
}
const SKELETON =
	'Auto-decided: reuse existing code (Reuse session_language) over adding i18next because'
const SCOUT_MARK = '`pkg:scout session prose` ranked a close pair'
const EVIDENCE_LINE = '- body: "session_language"'

beforeEach(() => {
	read_mock.mockReset().mockResolvedValue({ kind: 'sources', sources: [BODY], untrusted_count: 0 })
	judge_mock.mockReset().mockResolvedValue({
		kind: 'answered',
		decision: 'Reuse session_language',
		decision_kind: 'reuse',
		evidence: [{ source: BODY, quote: 'session_language' }],
	})
	comment_mock.mockReset().mockResolvedValue(URL)
})

afterEach(() => {
	vi.unstubAllEnvs()
})

// An empty value resolves as an unset one does (`session-language.ts`).
async function body_in(lang: string): Promise<string> {
	vi.stubEnv(session_language.ENV_KEY, lang)
	await package_scout_reuse.check(REQUEST)

	return String(comment_mock.mock.calls.at(-1)?.[1])
}

describe('package_scout_reuse.check — the Auto-decided comment follows the session language', () => {
	it.each(['', 'ja'])('writes the reason in Japanese when the language is "%s"', async (lang) => {
		expect(await body_in(lang)).toBe(
			[
				`${SKELETON} この Issue が再利用を決めている — ${SCOUT_MARK}。依存は追加しない（Tier A）。`,
				'',
				'根拠:',
				EVIDENCE_LINE,
			].join('\n'),
		)
	})

	it('writes the reason in English when the language is en', async () => {
		expect(await body_in('en')).toBe(
			[
				`${SKELETON} this Issue decides it — ${SCOUT_MARK}, so no dependency is added (Tier A).`,
				'',
				'Evidence:',
				EVIDENCE_LINE,
			].join('\n'),
		)
	})

	it.each(['ja', 'en'])('settles a re-run on a record written in %s', async (lang) => {
		const text = await body_in(lang)

		read_mock.mockResolvedValue({
			kind: 'sources',
			sources: [BODY, { ...BODY, id: URL, order: 1, text }],
			untrusted_count: 0,
		})
		judge_mock.mockClear()

		expect(await package_scout_reuse.check(REQUEST)).toMatchObject({ kind: 'recorded', url: URL })
		expect(judge_mock).not.toHaveBeenCalled()
	})
})
