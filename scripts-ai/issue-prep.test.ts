import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#1063: `josh issue <N>` used to spawn `gh issue view` / `gh label create` /
// `gh issue edit`, which go through GraphQL and are answered 403 in a cloud session. The observable
// behavior — the title it prints and the `in-progress` label it applies — is unchanged; what these
// tests pin is that it now asks the REST layer for both, and that a refused read or a refused label
// still ends the command non-zero rather than reporting a run it did not make.

const MOCK_ISSUE_TITLE = vi.hoisted(() => 'Fix login bug')
const IN_PROGRESS_LABEL = 'in-progress'
const ISSUE_NUMBER = '42'
const PROCESS_EXIT_CALLED = 'process.exit called'

const issue_get_title_mock = vi.hoisted(() => vi.fn())
const issue_view_json_classified_mock = vi.hoisted(() => vi.fn())
const label_ensure_mock = vi.hoisted(() => vi.fn())
const issue_add_label_mock = vi.hoisted(() => vi.fn())

vi.mock('../scripts/git/git-gh-issue-read', () => ({
	git_gh_issue_read: {
		issue_get_title: issue_get_title_mock,
		issue_view_json_classified: issue_view_json_classified_mock,
	},
}))

vi.mock('../scripts/git/git-gh-issue-write', () => ({
	git_gh_issue_write: { label_ensure: label_ensure_mock, issue_add_label: issue_add_label_mock },
}))

vi.mock('../scripts/issue/issue-logic', () => ({
	issue_logic: {
		prepare: vi.fn().mockReturnValue({
			title: MOCK_ISSUE_TITLE,
			is_cjk: false,
			suggested_branch: '42-fix-login-bug',
		}),
	},
}))

process.argv = ['node', 'issue-prep.ts', ISSUE_NUMBER]

const { issue_prep } = await import('./issue-prep')

beforeEach(() => {
	vi.clearAllMocks()
	issue_get_title_mock.mockResolvedValue(MOCK_ISSUE_TITLE)
	issue_view_json_classified_mock.mockResolvedValue({ kind: 'unreadable' })
	label_ensure_mock.mockResolvedValue(undefined)
	issue_add_label_mock.mockResolvedValue(true)
	vi.spyOn(process, 'exit').mockImplementation(() => {
		throw new Error(PROCESS_EXIT_CALLED)
	})
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
})

describe('display_language_status', () => {
	it('returns CJK warning for true', () => {
		expect(issue_prep.display_language_status(true)).toBe(
			'⚠ Contains CJK — needs English translation',
		)
	})

	it('returns English confirmation for false', () => {
		expect(issue_prep.display_language_status(false)).toBe('✔ English')
	})
})

describe('fetch_title_for_issue', () => {
	it('reads the title through the REST issue reader', async () => {
		await issue_prep.fetch_title_for_issue(ISSUE_NUMBER)

		expect(issue_get_title_mock).toHaveBeenCalledWith(ISSUE_NUMBER)
	})

	it('returns the title it read', async () => {
		await expect(issue_prep.fetch_title_for_issue(ISSUE_NUMBER)).resolves.toBe(MOCK_ISSUE_TITLE)
	})

	// The reader answers `undefined` for a failed read and for an empty title alike, which is the
	// "there is no title to work from" the old spawn reported by throwing. Both still end the run.
	it('exits when the issue could not be read', async () => {
		issue_get_title_mock.mockResolvedValue(undefined)

		await expect(issue_prep.fetch_title_for_issue(ISSUE_NUMBER)).rejects.toThrow(
			PROCESS_EXIT_CALLED,
		)
	})

	// The old spawn printed gh's stderr, and the REST reader swallows it. A 403 — the failure this
	// whole change is about — must not arrive as a bare "failed to fetch", so the reason is read
	// back from the classified probe instead of being lost.
	it('says the request failed when the read was refused', async () => {
		issue_get_title_mock.mockResolvedValue(undefined)
		issue_view_json_classified_mock.mockResolvedValue({ kind: 'unreadable' })

		await expect(issue_prep.fetch_title_for_issue(ISSUE_NUMBER)).rejects.toThrow(
			PROCESS_EXIT_CALLED,
		)
		expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('the request failed')
	})

	// A number that resolves to nothing is an answer, not a gap, and reporting it as a failed read
	// sends the reader looking for a network problem that is not there.
	it('says the number does not resolve when GitHub has no such issue', async () => {
		issue_get_title_mock.mockResolvedValue(undefined)
		issue_view_json_classified_mock.mockResolvedValue({ kind: 'missing' })

		await expect(issue_prep.fetch_title_for_issue(ISSUE_NUMBER)).rejects.toThrow(
			PROCESS_EXIT_CALLED,
		)
		expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('does not resolve')
	})
})

describe('ensure_in_progress_label', () => {
	it('creates the label through the REST label writer', async () => {
		await issue_prep.ensure_in_progress_label()

		expect(label_ensure_mock).toHaveBeenCalledWith({
			name: IN_PROGRESS_LABEL,
			color: '#0075ca',
			description: 'Work is actively in progress',
		})
	})

	// `label_ensure` swallows the 422 an existing label answers with, so an already-created label is
	// not an error here — the same `|| true` the old `gh label create` call site spelled out.
	it('does not throw when the label already exists', async () => {
		await expect(issue_prep.ensure_in_progress_label()).resolves.toBeUndefined()
	})
})

describe('assign_in_progress_label', () => {
	it('applies the label through the REST issue writer', async () => {
		await issue_prep.assign_in_progress_label(ISSUE_NUMBER)

		expect(issue_add_label_mock).toHaveBeenCalledWith(ISSUE_NUMBER, IN_PROGRESS_LABEL)
	})

	// Applying the label is the one thing this command exists to do, so a refused edit ends the run
	// non-zero exactly as the old uncaught spawn failure did.
	it('exits when the label could not be applied', async () => {
		issue_add_label_mock.mockResolvedValue(false)

		await expect(issue_prep.assign_in_progress_label(ISSUE_NUMBER)).rejects.toThrow(
			PROCESS_EXIT_CALLED,
		)
	})
})
