import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		label_ensure: vi.fn(),
		issue_add_blocked_by: vi.fn(),
		issue_get_labels_and_body: vi.fn(),
		issue_edit_title: vi.fn(),
		issue_edit_body: vi.fn(),
		issue_add_label: vi.fn(),
	},
}))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const { epic_run } = await import('./epic-run')

const EPIC_NUMBER = 858
const TITLE = 'Split the request into its deliverables'
const SUCCESS_EXIT_CODE = 0

function promote_input(title?: string): Parameters<typeof epic_run.promote_epic>[0] {
	return { epic_number: EPIC_NUMBER, children: [101, 102], rationale: '', is_ordered: false, title }
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	vi.mocked(git_gh_command.issue_get_labels_and_body).mockResolvedValue(
		JSON.stringify({ number: EPIC_NUMBER, labels: [], body: 'The request.' }),
	)
	vi.mocked(git_gh_command.issue_edit_title).mockResolvedValue('https://example.test/858')
	vi.mocked(git_gh_command.issue_add_label).mockResolvedValue(true)
	vi.mocked(git_gh_command.issue_add_blocked_by).mockResolvedValue(true)
})

describe('epic_run.promote_epic — the --title rename', () => {
	it('renames the promoted issue to the given title', async () => {
		expect(await epic_run.promote_epic(promote_input(TITLE))).toBe(SUCCESS_EXIT_CODE)

		expect(git_gh_command.issue_edit_title).toHaveBeenCalledWith(String(EPIC_NUMBER), TITLE)
		expect(git_gh_command.issue_edit_body).toHaveBeenCalledOnce()
	})

	it('leaves the title alone without --title', async () => {
		expect(await epic_run.promote_epic(promote_input())).toBe(SUCCESS_EXIT_CODE)

		expect(git_gh_command.issue_edit_title).not.toHaveBeenCalled()
	})
})
