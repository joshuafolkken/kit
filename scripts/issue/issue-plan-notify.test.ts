import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#scripts/gh/git-gh-repo', () => ({
	git_gh_repo: { repo_get_name_with_owner: vi.fn() },
}))
vi.mock('#scripts/notify/telegram-test', () => ({
	telegram_test: { send_values: vi.fn() },
}))

const { git_gh_repo } = await import('#scripts/gh/git-gh-repo')
const { telegram_test } = await import('#scripts/notify/telegram-test')
const { issue_plan_notify } = await import('./issue-plan-notify')

const NEXT_LINE = 'Next: halfrun #42 | prrun #42 | fullrun #42'
const PLAN = [
	'### 変更',
	'- first',
	'  - a detail of the first',
	'- second',
	'```',
	'- fenced',
	'```',
	'- third',
	'- fourth',
	'### 確認',
	'- not a change',
].join('\n')

function notice(overrides: { repo?: string; title?: string } = {}): {
	issue_number: string
	plan: string
	title: string | undefined
	repo: string | undefined
} {
	return { issue_number: '42', plan: PLAN, title: overrides.title, repo: overrides.repo }
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	vi.mocked(git_gh_repo.repo_get_name_with_owner).mockResolvedValue('joshuafolkken/kit')
	vi.mocked(telegram_test.send_values).mockResolvedValue(undefined)
})

describe('issue_plan_notify.summary_of — the plan summary the notification carries', () => {
	it('takes the first three top-level items of the change section', () => {
		expect(issue_plan_notify.summary_of(PLAN)).toEqual(['first', 'second', 'third'])
	})

	it('reads a `##` change heading as well', () => {
		expect(issue_plan_notify.summary_of('## 変更\n- only')).toEqual(['only'])
	})

	it('is empty for a plan without a change section', () => {
		expect(issue_plan_notify.summary_of('### 確認\n- a check')).toEqual([])
	})
})

describe('issue_plan_notify.send — the planning notification', () => {
	it('sends the summary and the kickoff Next line as a planning message on the issue', async () => {
		await issue_plan_notify.send(notice())

		expect(telegram_test.send_values).toHaveBeenCalledWith({
			'task-type': 'planning',
			body: `- first\n- second\n- third\n${NEXT_LINE}`,
			'issue-url': 'https://github.com/joshuafolkken/kit/issues/42',
		})
	})

	it('addresses the --repo repository and passes a known title through', async () => {
		await issue_plan_notify.send(notice({ repo: 'joshuafolkken/other', title: 'A title' }))

		expect(telegram_test.send_values).toHaveBeenCalledWith(
			expect.objectContaining({
				'issue-url': 'https://github.com/joshuafolkken/other/issues/42',
				'issue-title': 'A title',
			}),
		)
		expect(git_gh_repo.repo_get_name_with_owner).not.toHaveBeenCalled()
	})

	it('warns rather than throwing when the send fails', async () => {
		vi.mocked(telegram_test.send_values).mockRejectedValue(new Error('offline'))

		await expect(issue_plan_notify.send(notice())).resolves.toBeUndefined()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('offline'))
	})
})
