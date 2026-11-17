import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { session_language } from '#scripts/josh/session-language'
import { PACKAGE_JSON } from '#scripts/lib/package-manifest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive_escalate } from './backlog-drive-escalate'

// joshuafolkken/kit#7703: only the sentences a person reads follow `JOSH_SESSION_LANG`; the
// `- Reason:` / `- Next:` labels, label names and profile names stay English in either language.

const ISSUE = 7703
const DIRECTORY = path.join(os.tmpdir(), 'josh-test-escalate-language', String(ISSUE))
const REASON = 'escalation requested: needs a stronger model'
const HAIKU = { name: 'haiku', model: 'claude-haiku-5-5', effort: 'low', when: 'Mechanical work' }
const SONNET = { name: 'sonnet', model: 'claude-sonnet-5-5', effort: 'medium', when: 'A brief' }
const HAIKU_WORKER = '`worker:haiku` (claude-haiku-5-5 / low)'
const SONNET_WORKER = '`worker:sonnet` (claude-sonnet-5-5 / medium)'
const STEP_JAPANESE = '担当を'
const STEP_ENGLISH = 'Escalated the worker'
const TOP_JAPANESE = 'josh.worker.profiles の最上位'
const TOP_ENGLISH = 'is the top of josh.worker.profiles'
const HAIKU_LABEL = 'worker:haiku'
const SONNET_LABEL = 'worker:sonnet'

beforeEach(() => {
	mkdirSync(DIRECTORY, { recursive: true })
	const worker = { default: HAIKU.name, escalate: true, profiles: [HAIKU, SONNET] }

	writeFileSync(path.join(DIRECTORY, PACKAGE_JSON), JSON.stringify({ josh: { worker } }), 'utf8')
	vi.spyOn(git_gh_issue_write, 'issue_add_label').mockResolvedValue(true)
	vi.spyOn(git_gh_issue_write, 'issue_clear_label').mockResolvedValue(true)
	vi.spyOn(git_gh_issue_write, 'issue_try_comment').mockResolvedValue(true)
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
	rmSync(DIRECTORY, { recursive: true, force: true })
})

// An empty value resolves as an unset one does (`session-language.ts`).
async function comment_in(lang: string, label: string): Promise<string> {
	vi.stubEnv(session_language.ENV_KEY, lang)
	vi.mocked(git_gh_issue_write.issue_try_comment).mockClear()
	const ports = {
		labels: vi.fn(async () => [label]),
		retry: vi.fn<(issue: number) => Promise<void>>().mockResolvedValue(),
	}

	await backlog_drive_escalate.escalate(ISSUE, REASON, ports, DIRECTORY)

	return vi.mocked(git_gh_issue_write.issue_try_comment).mock.calls[0]?.[1] ?? ''
}

describe('backlog_drive_escalate.escalate — the step-up note follows the session language', () => {
	it.each(['', 'ja'])('writes the sentence in Japanese when the language is "%s"', async (lang) => {
		const comment = await comment_in(lang, HAIKU_LABEL)

		expect(comment).toContain(STEP_JAPANESE)
		expect(comment).not.toContain(STEP_ENGLISH)
	})

	it('writes the sentence in English when the language is en', async () => {
		const comment = await comment_in('en', HAIKU_LABEL)

		expect(comment).toContain(STEP_ENGLISH)
		expect(comment).not.toContain(STEP_JAPANESE)
	})

	it.each(['ja', 'en'])('keeps the workers and the Reason line English in %s', async (lang) => {
		const comment = await comment_in(lang, HAIKU_LABEL)

		expect(comment).toContain(HAIKU_WORKER)
		expect(comment).toContain(SONNET_WORKER)
		expect(comment.split('\n', 2)[1]).toBe(`- Reason: ${REASON}`)
	})
})

describe('backlog_drive_escalate.escalate — the top-profile note follows the session language', () => {
	it.each(['', 'ja'])(
		'writes the sentences in Japanese when the language is "%s"',
		async (lang) => {
			const comment = await comment_in(lang, SONNET_LABEL)

			expect(comment).toContain(TOP_JAPANESE)
			expect(comment).toContain('- Next: 続け方は人が決める。')
			expect(comment).not.toContain(TOP_ENGLISH)
		},
	)

	it('writes the sentences in English when the language is en', async () => {
		const comment = await comment_in('en', SONNET_LABEL)

		expect(comment).toContain(TOP_ENGLISH)
		expect(comment).toContain('- Next: a person decides how to go on.')
		expect(comment).not.toContain(TOP_JAPANESE)
	})

	it.each(['ja', 'en'])('keeps the label names and the line labels English in %s', async (lang) => {
		const comment = await comment_in(lang, SONNET_LABEL)
		const lines = comment.split('\n')

		expect(lines[0]).toContain(`\`${NEEDS_DECISION_LABEL}\``)
		expect(lines[0]).toContain(`\`${SONNET_LABEL}\``)
		expect(lines[1]).toBe(`- Reason: ${REASON}`)
		expect(lines[2]?.startsWith('- Next: ')).toBe(true)
	})
})
