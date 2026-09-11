import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_followup_label } from './git-followup-label'
import { git_gh_command } from './git-gh-command'

vi.mock('./git-gh-command', () => ({
	git_gh_command: {
		issue_get_labels_and_body: vi.fn(),
		issue_remove_label: vi.fn(),
	},
}))

const ISSUE_NUMBER = '1794'
const IN_PROGRESS = 'in-progress'
// GitHub keeps the casing a label was created with, so a repository that created it before these
// scripts did answers with this spelling for the same label (joshuafolkken/kit#1132).
const CREATED_CASING = 'In-Progress'
const DEPTH_LABEL = 'depth:1'
const UNREADABLE = /no readable labels/u

const mocked_read = vi.mocked(git_gh_command.issue_get_labels_and_body)
const mocked_remove = vi.mocked(git_gh_command.issue_remove_label)

function serve_labels(...names: ReadonlyArray<string>): void {
	mocked_read.mockResolvedValue(JSON.stringify({ labels: names.map((name) => ({ name })) }))
}

beforeEach(() => {
	vi.clearAllMocks()
	serve_labels(IN_PROGRESS, DEPTH_LABEL)
	mocked_remove.mockResolvedValue()
})

describe('strip_in_progress — the label a merged run no longer holds', () => {
	it('removes the label from the issue', async () => {
		await git_followup_label.strip_in_progress(ISSUE_NUMBER)

		expect(mocked_remove).toHaveBeenCalledWith(ISSUE_NUMBER, IN_PROGRESS)
	})

	it('leaves the issue alone when it does not carry the label', async () => {
		serve_labels(DEPTH_LABEL)

		await git_followup_label.strip_in_progress(ISSUE_NUMBER)

		expect(mocked_remove).not.toHaveBeenCalled()
	})

	it('treats an issue with no labels at all as nothing to do', async () => {
		mocked_read.mockResolvedValue(JSON.stringify({ number: 1794 }))

		await git_followup_label.strip_in_progress(ISSUE_NUMBER)

		expect(mocked_remove).not.toHaveBeenCalled()
	})
})

describe('strip_in_progress — the comparison ignores casing, the removal does not', () => {
	it('matches the label whatever casing GitHub stored it with', async () => {
		serve_labels(CREATED_CASING)

		await git_followup_label.strip_in_progress(ISSUE_NUMBER)

		expect(mocked_remove).toHaveBeenCalledTimes(1)
	})

	// The name travels in the request path, so sending the lowercase constant would ask GitHub to
	// match a spelling nobody read — the removal sends back exactly what the issue answered with.
	it('sends the stored spelling rather than the lowercase name it matched', async () => {
		serve_labels(CREATED_CASING)

		await git_followup_label.strip_in_progress(ISSUE_NUMBER)

		expect(mocked_remove).toHaveBeenCalledWith(ISSUE_NUMBER, CREATED_CASING)
	})
})

describe('strip_in_progress — a gap is never read as "no label"', () => {
	it('throws when the labels could not be read', async () => {
		mocked_read.mockResolvedValue(undefined)

		await expect(git_followup_label.strip_in_progress(ISSUE_NUMBER)).rejects.toThrow(UNREADABLE)
	})

	it('throws when the answer is not JSON at all', async () => {
		mocked_read.mockResolvedValue('gh: Not Found (HTTP 404)')

		await expect(git_followup_label.strip_in_progress(ISSUE_NUMBER)).rejects.toThrow(UNREADABLE)
	})

	it('does not remove anything on an unreadable answer', async () => {
		mocked_read.mockResolvedValue(undefined)

		await expect(git_followup_label.strip_in_progress(ISSUE_NUMBER)).rejects.toThrow(UNREADABLE)
		expect(mocked_remove).not.toHaveBeenCalled()
	})
})

// A run whose pull request named no issue has nothing to strip. It is not a failure: the missing
// number is already reported where the completion report is.
describe('strip_in_progress — no issue number', () => {
	it('reads nothing and removes nothing', async () => {
		await git_followup_label.strip_in_progress(undefined)

		expect(mocked_read).not.toHaveBeenCalled()
		expect(mocked_remove).not.toHaveBeenCalled()
	})
})
