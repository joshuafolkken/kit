// cspell:words coderabbit coderabbitai
import { session_language } from '#scripts/josh/session-language'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RETRY_PENDING_KEY } from './git-gh-comments-unreadable'
import { handle_ai_review_findings, type TelegramContext } from './git-pr-ai-review'
import { git_pr_coderabbit } from './git-pr-coderabbit'

// joshuafolkken/kit#7669: both reviewer gates post the session-language prose, so a `ja` session reads
// Japanese on the pull request and in the confirmation it is sent.

vi.mock('./git-gh-command', () => ({
	git_gh_command: {
		pr_get_comments: vi.fn(),
		pr_get_review_comments: vi.fn(),
		pr_comment: vi.fn(),
	},
}))

vi.mock('#scripts/notify/telegram-notify', () => ({
	telegram_notify: { send: vi.fn(), send_or_report: vi.fn() },
}))

const { git_gh_command } = await import('./git-gh-command')
const { telegram_notify } = await import('#scripts/notify/telegram-notify')
const mocked_pr_comment = vi.mocked(git_gh_command.pr_comment)

const BRANCH = 'feature-branch'
const REASON = 'Tracked in follow-up Issue #999'
const CONTEXT: TelegramContext = {
	repo_name: 'kit',
	issue_title: 'Fix bug',
	issue_url: 'https://github.com/owner/repo/issues/1',
	pr_url: 'https://github.com/owner/repo/pull/2',
}
const AI_BLOCKER = {
	author: { login: 'claude[bot]' },
	body: '## Code Review\n\n### Issues\n\n#### Logic bug — oops\n\n```ts\nconst x = 1\n```',
	url: 'https://github.com/owner/repo/pull/2#issuecomment-1',
}
const CR_FINDING = {
	user: { login: 'coderabbitai[bot]' },
	body: '_⚠️ Potential issue_ off by one',
	html_url: 'https://github.com/owner/repo/pull/2#discussion_r1',
}
const AI_IGNORED = 'AI レビューの指摘の一部を、意図して未解決のまま残した。'
const AI_UNREADABLE = 'AI レビューのコメントを読めなかった'
const CR_UNREADABLE = 'CodeRabbit の行コメントを読めなかった'
const JA_REASON = `理由: ${REASON}`

function posted(): string {
	return String(mocked_pr_comment.mock.calls[0]?.[1])
}

beforeEach(() => {
	vi.stubEnv(session_language.ENV_KEY, 'ja')
	vi.stubEnv(RETRY_PENDING_KEY, undefined)
	mocked_pr_comment.mockResolvedValue('')
})

describe('the AI review gate in a ja session', () => {
	it('posts the ignore comment in Japanese', async () => {
		vi.mocked(git_gh_command.pr_get_comments).mockResolvedValue(JSON.stringify([AI_BLOCKER]))

		await handle_ai_review_findings({
			branch_name: BRANCH,
			ignore_reason: REASON,
			context: CONTEXT,
		})

		expect(posted()).toContain(`${AI_IGNORED}\n${JA_REASON}\n対象のコメント:`)
	})

	it('offers the ignore alternative in Japanese when a finding stops it', async () => {
		vi.mocked(git_gh_command.pr_get_comments).mockResolvedValue(JSON.stringify([AI_BLOCKER]))
		const input = { branch_name: BRANCH, ignore_reason: undefined, context: CONTEXT }

		await expect(handle_ai_review_findings(input)).rejects.toThrow()
		expect(JSON.stringify(vi.mocked(telegram_notify.send_or_report).mock.calls)).toContain(
			'ゲートが当てはまらないなら',
		)
	})
})

describe('the AI review gate in a ja session — comments that cannot be read', () => {
	it('stops and notifies in Japanese when the comments cannot be read', async () => {
		vi.mocked(git_gh_command.pr_get_comments).mockResolvedValue(undefined)
		const input = { branch_name: BRANCH, ignore_reason: undefined, context: CONTEXT }

		await expect(handle_ai_review_findings(input)).rejects.toThrow(AI_UNREADABLE)
		expect(JSON.stringify(vi.mocked(telegram_notify.send_or_report).mock.calls)).toContain(
			AI_UNREADABLE,
		)
	})

	it('records an ignore reason in Japanese when the comments cannot be read', async () => {
		vi.mocked(git_gh_command.pr_get_comments).mockResolvedValue(undefined)

		await handle_ai_review_findings({
			branch_name: BRANCH,
			ignore_reason: REASON,
			context: CONTEXT,
		})

		expect(posted()).toContain(AI_UNREADABLE)
		expect(posted()).toContain(JA_REASON)
	})
})

describe('the CodeRabbit gate in a ja session', () => {
	it('posts the ignore comment listing the findings in Japanese', async () => {
		vi.mocked(git_gh_command.pr_get_review_comments).mockResolvedValue(JSON.stringify([CR_FINDING]))

		await git_pr_coderabbit.handle_coderabbit_findings({
			branch_name: BRANCH,
			ignore_reason: REASON,
		})

		expect(posted()).toBe(
			[
				'CodeRabbit の指摘の一部を、意図して未解決のまま残した。',
				JA_REASON,
				'対象のコメント:',
				`- ${CR_FINDING.html_url}`,
			].join('\n'),
		)
	})

	it('notes and records the unread listing in Japanese', async () => {
		vi.mocked(git_gh_command.pr_get_review_comments).mockResolvedValue(undefined)
		vi.spyOn(console, 'warn').mockReturnValue(undefined)

		const notes = await git_pr_coderabbit.handle_coderabbit_findings({
			branch_name: BRANCH,
			ignore_reason: REASON,
		})

		expect(notes.join('\n')).toContain(CR_UNREADABLE)
		expect(posted()).toContain(CR_UNREADABLE)
		expect(posted()).toContain(JA_REASON)
	})
})
