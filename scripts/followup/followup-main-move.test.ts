import { beforeEach, describe, expect, it, vi } from 'vitest'
import { followup_main_move, OBSERVATION_SLUG } from './followup-main-move'

vi.mock('#scripts/git/git-command', () => ({
	git_command: { get_default_branch: vi.fn(), fetch_branch: vi.fn(), log_first_parent: vi.fn() },
}))

vi.mock('#scripts/git/main-merge-guard', () => ({
	main_merge_guard: { incoming_paths: vi.fn() },
}))

vi.mock(import('./followup-failed-tests'), async (import_original) => {
	const actual = await import_original()

	return {
		...actual,
		followup_failed_tests: { ...actual.followup_failed_tests, record_entry: vi.fn() },
	}
})

const { git_command } = await import('#scripts/git/git-command')
const { main_merge_guard } = await import('#scripts/git/main-merge-guard')
const { followup_failed_tests } = await import('./followup-failed-tests')

const fetch_branch = vi.mocked(git_command.fetch_branch)
const log_first_parent = vi.mocked(git_command.log_first_parent)
const incoming_paths = vi.mocked(main_merge_guard.incoming_paths)
const record_entry = vi.mocked(followup_failed_tests.record_entry)

const FAILED_TEST = 'scripts/review/review-stops-cli.test.ts'
const MAIN_COMMIT = '0123456789abcdef0123456789abcdef01234567'
const SHORT_COMMIT = '0123456789ab'
const MAIN_REF = 'origin/main'
const ISSUE = 5266

beforeEach(() => {
	vi.mocked(git_command.get_default_branch).mockReset().mockResolvedValue('main')
	fetch_branch.mockReset().mockResolvedValue('')
	log_first_parent.mockReset().mockResolvedValue([MAIN_COMMIT])
	incoming_paths.mockReset()
	record_entry.mockReset().mockResolvedValue()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

// joshuafolkken/kit#5316: the test #5267 fixed on main was rerun on #5266's old base and went red again.
describe('read_main_move', () => {
	it('names the failed test main changed, with main’s latest commit on it', async () => {
		incoming_paths.mockResolvedValue([FAILED_TEST, 'README.md'])

		expect(await followup_main_move.read_main_move([FAILED_TEST])).toStrictEqual({
			files: [FAILED_TEST],
			commit: MAIN_COMMIT,
		})
		expect(fetch_branch).toHaveBeenCalledWith('main')
		expect(log_first_parent).toHaveBeenCalledWith(1, FAILED_TEST, MAIN_REF)
	})

	it('counts a move of the subject module the test is named after', async () => {
		const subject = 'scripts/review/review-stops-cli.ts'

		incoming_paths.mockResolvedValue([subject])

		const move = await followup_main_move.read_main_move([FAILED_TEST])

		expect(move).toStrictEqual({ files: [FAILED_TEST], commit: MAIN_COMMIT })
		expect(log_first_parent).toHaveBeenCalledWith(1, subject, MAIN_REF)
	})

	it.each([
		['main moved other files only', ['README.md']],
		['main did not move', []],
	])('answers nothing when %s', async (_label, incoming) => {
		incoming_paths.mockResolvedValue(incoming)

		expect(await followup_main_move.read_main_move([FAILED_TEST])).toBeUndefined()
	})

	it('reads nothing for no failed test file', async () => {
		expect(await followup_main_move.read_main_move([])).toBeUndefined()
		expect(fetch_branch).not.toHaveBeenCalled()
	})
})

describe('should_merge_first', () => {
	it('skips the rerun and records the failed file and main’s commit', async () => {
		incoming_paths.mockResolvedValue([FAILED_TEST])

		expect(await followup_main_move.should_merge_first([FAILED_TEST], ISSUE)).toBe(true)

		const [entry, issue] = record_entry.mock.calls[0] ?? []

		expect(entry).toMatchObject({ slug: OBSERVATION_SLUG, where: FAILED_TEST })
		expect(entry?.what).toContain(SHORT_COMMIT)
		expect(issue).toBe(ISSUE)
	})

	it('keeps the rerun and reports it when main cannot be fetched', async () => {
		fetch_branch.mockRejectedValue(new Error('ssh: connection closed'))

		expect(await followup_main_move.should_merge_first([FAILED_TEST], ISSUE)).toBe(false)
		expect(console.info).toHaveBeenCalledWith(
			expect.stringContaining('⚠️ Could not compare the failed tests with main'),
		)
		expect(record_entry).not.toHaveBeenCalled()
	})

	it('keeps the rerun and records nothing when main did not change the test', async () => {
		incoming_paths.mockResolvedValue([])

		expect(await followup_main_move.should_merge_first([FAILED_TEST], ISSUE)).toBe(false)
		expect(record_entry).not.toHaveBeenCalled()
	})
})
