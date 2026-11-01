import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#scripts/gh/git-gh-repo', () => ({
	git_gh_repo: { repo_get_name_with_owner: vi.fn() },
}))
vi.mock('#scripts/notify/telegram-test', () => ({
	telegram_test: { send_values: vi.fn() },
}))

const { git_gh_repo } = await import('#scripts/gh/git-gh-repo')
const { telegram_test } = await import('#scripts/notify/telegram-test')
const { epic_notify } = await import('./epic-notify')

const SLUG = 'joshuafolkken/kit'
const NOTICE = { epic_number: 900, children: [901, 902], title: 'Epic: split the parser work' }
const RUN_LINE = 'Next: backlogrun #900 --only'

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	vi.mocked(git_gh_repo.repo_get_name_with_owner).mockResolvedValue(SLUG)
	vi.mocked(telegram_test.send_values).mockResolvedValue(undefined)
})

describe('epic_notify.body_of — the split announcement', () => {
	it('lists every child URL, then the backlogrun line', () => {
		expect(epic_notify.body_of(NOTICE, SLUG)).toBe(
			[
				'- https://github.com/joshuafolkken/kit/issues/901',
				'- https://github.com/joshuafolkken/kit/issues/902',
				RUN_LINE,
			].join('\n'),
		)
	})
})

describe('epic_notify.announce — whether the epic is announced', () => {
	const REQUEST = { is_notified: true, children: NOTICE.children, title: NOTICE.title }

	it('sends once the epic exists and --notify was given', async () => {
		await epic_notify.announce(REQUEST, NOTICE.epic_number)

		expect(telegram_test.send_values).toHaveBeenCalledOnce()
	})

	it('sends nothing without --notify', async () => {
		await epic_notify.announce({ ...REQUEST, is_notified: false }, NOTICE.epic_number)

		expect(telegram_test.send_values).not.toHaveBeenCalled()
	})

	it('sends nothing when there is no epic to announce', async () => {
		await epic_notify.announce(REQUEST, undefined)

		expect(telegram_test.send_values).not.toHaveBeenCalled()
	})
})

describe('epic_notify.send — the planning Telegram', () => {
	it('sends a planning message on the epic, titled and listing its children', async () => {
		await epic_notify.send(NOTICE)

		expect(telegram_test.send_values).toHaveBeenCalledWith({
			'task-type': 'planning',
			body: epic_notify.body_of(NOTICE, SLUG),
			'issue-url': 'https://github.com/joshuafolkken/kit/issues/900',
			'issue-title': NOTICE.title,
		})
	})

	it('skips the send with a warning when the repository cannot be read', async () => {
		vi.mocked(git_gh_repo.repo_get_name_with_owner).mockResolvedValue(undefined)

		await epic_notify.send(NOTICE)

		expect(telegram_test.send_values).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('could not read'))
	})

	it('warns as epic rather than throwing when the send fails', async () => {
		vi.mocked(telegram_test.send_values).mockRejectedValue(new Error('offline'))

		await expect(epic_notify.send(NOTICE)).resolves.toBeUndefined()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('epic could not send'))
	})
})
