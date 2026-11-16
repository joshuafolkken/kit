import { session_language } from '#scripts/josh/session-language'
import { describe, expect, it, vi } from 'vitest'
import { git_pr_review_prose } from './git-pr-review-prose'

// joshuafolkken/kit#7669: the prose `followup` posts when it leaves review findings unresolved or cannot
// read them follows the session language; the commands and the `kit#753` reference do not.

const REASON = '  the finding is a false positive  '
const AFFECTED = ['- https://github.com/owner/repo/pull/2#discussion_r1']
const IGNORE_COMMAND = '`pnpm josh followup --ai-review-ignore-reason "<reason>"`'

const JA = {
	ai: 'AI レビューの指摘の一部を、意図して未解決のまま残した。',
	coderabbit: 'CodeRabbit の指摘の一部を、意図して未解決のまま残した。',
	reason: '理由: the finding is a false positive',
	affected: '対象のコメント:',
	unreadable_ai:
		'AI レビューのコメントを読めなかったので、指摘が無いことを確かめられなかった。\n' +
		'読めるようになってから `pnpm josh followup` を再実行するか、無視の理由を渡す。',
	unreadable_cr:
		'CodeRabbit の行コメントを読めなかったので、未解決の指摘を確かめていない (kit#753)。',
	ignore_alternative: `ゲートが当てはまらないなら ${IGNORE_COMMAND} を再実行する`,
	unresolved: 'AI レビューの指摘が未解決のまま残っている。',
	fix_findings: '指摘を直して `pnpm josh followup` を再実行する',
	reread: 'コメントを読めるようになってから `pnpm josh followup` を再実行する',
}

const EN = {
	ai: 'Some AI reviewer findings were intentionally left unresolved.',
	coderabbit: 'Some CodeRabbit findings were intentionally left unresolved.',
	reason: 'Reason: the finding is a false positive',
	affected: 'Affected comments:',
	unreadable_ai:
		'The AI reviewer comments could not be read, so no finding could be ruled out.\n' +
		'Re-run `pnpm josh followup` once the read succeeds, or pass an ignore reason.',
	unreadable_cr:
		'CodeRabbit line comments could not be read; unresolved findings were not checked (kit#753).',
	ignore_alternative: `Re-run ${IGNORE_COMMAND} if the gate does not apply`,
	unresolved: 'AI reviewer findings remain unresolved.',
	fix_findings: 'Fix the findings and re-run `pnpm josh followup`',
	reread: 'Re-run `pnpm josh followup` once the comments can be read',
}

const CASES = [
	['ja', JA],
	['', JA],
	['en', EN],
] as const

describe('git_pr_review_prose — the session language', () => {
	it.each(CASES)('writes the ignore comments in %j', (lang, prose) => {
		vi.stubEnv(session_language.ENV_KEY, lang)

		expect(git_pr_review_prose.ignore_comment('ai', REASON, AFFECTED)).toBe(
			[prose.ai, prose.reason, prose.affected, ...AFFECTED].join('\n'),
		)
		expect(git_pr_review_prose.ignore_comment('coderabbit', REASON, AFFECTED)).toBe(
			[prose.coderabbit, prose.reason, prose.affected, ...AFFECTED].join('\n'),
		)
	})

	it.each(CASES)('writes the unreadable notes and the alternative in %j', (lang, prose) => {
		vi.stubEnv(session_language.ENV_KEY, lang)

		expect(git_pr_review_prose.unreadable_ai()).toBe(prose.unreadable_ai)
		expect(git_pr_review_prose.unreadable_cr()).toBe(prose.unreadable_cr)
		expect(git_pr_review_prose.ignore_alternative()).toBe(prose.ignore_alternative)
		expect(git_pr_review_prose.with_reason('body', REASON)).toBe(`body\n${prose.reason}`)
	})

	it.each(CASES)('writes the stop confirmation lines in %j', (lang, prose) => {
		vi.stubEnv(session_language.ENV_KEY, lang)

		expect(git_pr_review_prose.unresolved()).toBe(prose.unresolved)
		expect(git_pr_review_prose.fix_findings()).toBe(prose.fix_findings)
		expect(git_pr_review_prose.reread()).toBe(prose.reread)
	})

	it.each(['ja', 'en'])('keeps the command and the policy reference unchanged in %j', (lang) => {
		vi.stubEnv(session_language.ENV_KEY, lang)

		expect(git_pr_review_prose.ignore_alternative()).toContain(IGNORE_COMMAND)
		expect(git_pr_review_prose.unreadable_ai()).toContain('`pnpm josh followup`')
		expect(git_pr_review_prose.unreadable_cr()).toContain('(kit#753)')
	})
})
