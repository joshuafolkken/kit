import type { EpicChild } from '#scripts/epic/epic-graph'
import type { EpicNextResult } from '#scripts/epic/epic-report'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { BUG_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { session_language } from '#scripts/josh/session-language'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_auto_triage } from './backlog-auto-triage'

// joshuafolkken/kit#7703: only the sentences a person reads follow `JOSH_SESSION_LANG`; the label
// names stay English in either language.

const REPO = 'owner/repo'
const NUMBER = 7703
const OUTSIDE_BODY = 'The board is slow.'
const JAPANESE_MARK = '機械的に'
const ENGLISH_MARK = 'Triaged mechanically'

function child(labels: ReadonlyArray<string>, body?: string): EpicChild {
	return { number: NUMBER, repo: REPO, state: 'OPEN', labels, blocked_by: [], body }
}

function run_result(children: ReadonlyArray<EpicChild>): EpicNextResult {
	return {
		verdict: 'run',
		candidates: [{ repo: REPO, children }],
		waiting: [],
		blocked_on_people: [],
		anomalies: [],
	}
}

const try_comment = vi.spyOn(git_gh_command, 'issue_try_comment')

beforeEach(() => {
	vi.spyOn(git_gh_command, 'issue_apply_label').mockResolvedValue({ is_applied: true })
	vi.spyOn(git_gh_command, 'read_label_names').mockResolvedValue([])
	try_comment.mockResolvedValue(true)
	try_comment.mockClear()
})

afterEach(() => {
	vi.unstubAllEnvs()
})

// An empty value resolves as an unset one does (`session-language.ts`).
async function comment_in(lang: string, labels: ReadonlyArray<string>): Promise<string> {
	vi.stubEnv(session_language.ENV_KEY, lang)
	try_comment.mockClear()
	await backlog_auto_triage.untriaged_of(run_result([child(labels, OUTSIDE_BODY)]), REPO)

	return try_comment.mock.calls[0]?.[1] ?? ''
}

describe('backlog_auto_triage — the triage comment follows the session language', () => {
	it.each(['', 'ja'])(
		'writes the sentences in Japanese when the language is "%s"',
		async (lang) => {
			const comment = await comment_in(lang, [])

			expect(comment).toContain(JAPANESE_MARK)
			expect(comment).toContain('ラベルが付いていない')
			expect(comment).not.toContain(ENGLISH_MARK)
		},
	)

	it('writes the sentences in English when the language is en', async () => {
		const comment = await comment_in('en', [])

		expect(comment).toContain(ENGLISH_MARK)
		expect(comment).toContain('it carries no')
		expect(comment).not.toContain(JAPANESE_MARK)
	})

	it.each(['', 'ja', 'en'])('writes the gate-path reason in "%s" too', async (lang) => {
		const comment = await comment_in(lang, [BUG_LABEL])
		const mark =
			lang === 'en' ? 'names no verification-gate path' : '検証ゲートのパスを挙げていない'

		expect(comment).toContain(mark)
	})

	it.each(['ja', 'en'])('keeps the label names English in %s', async (lang) => {
		const comment = await comment_in(lang, [BUG_LABEL])

		expect(comment).toContain(`\`${RUN_LANE_LABEL}\``)
		expect(comment).toContain(`\`${BUG_LABEL}\``)
		expect(comment).toContain('`run:solo`')
		expect(comment).toContain('`backlogrun-lanes.md`')
	})
})
