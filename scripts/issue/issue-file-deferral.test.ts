import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_file_deferral } from './issue-file-deferral'

// joshuafolkken/kit#4821: a filing that names `--found-during <N>` leaves its deferral on #N, so the
// ship reviewer reading `issue:read <N>` sees the scope already filed away.

const HERE = 'joshuafolkken/kit'
const FINDER = '4780'
const REFERENCE = '#4817'
const TITLE = 'Carry a reason with review:record findings'
const NOTE = `${issue_file_deferral.NOTE_PREFIX} ${REFERENCE} ${TITLE}`

const try_comment = vi.spyOn(git_gh_issue_write, 'issue_try_comment')
const error = vi.spyOn(console, 'error')

function deferral_of(
	found_during: string | undefined,
): Parameters<typeof issue_file_deferral.note_finder>[0] {
	return { found_during, reference: REFERENCE, title: TITLE, current: HERE }
}

beforeEach(() => {
	try_comment.mockResolvedValue(true)
	error.mockImplementation(() => undefined)
})

afterEach(() => {
	vi.clearAllMocks()
})

describe('issue_file_deferral.note_finder', () => {
	it('comments the deferral on the finder, in this repository', async () => {
		await issue_file_deferral.note_finder(deferral_of(FINDER))

		expect(try_comment).toHaveBeenCalledExactlyOnceWith(FINDER, NOTE, HERE)
		expect(error).not.toHaveBeenCalled()
	})

	it('comments nothing when no finder is named', async () => {
		await issue_file_deferral.note_finder(deferral_of(undefined))

		expect(try_comment).not.toHaveBeenCalled()
	})

	it('comments nothing on a finder that is not an Issue number', async () => {
		await issue_file_deferral.note_finder(deferral_of('0'))

		expect(try_comment).not.toHaveBeenCalled()
	})

	it('warns with the re-run when the comment is refused', async () => {
		try_comment.mockResolvedValue(false)

		await issue_file_deferral.note_finder(deferral_of(FINDER))

		expect(error).toHaveBeenCalledOnce()
		expect(error.mock.calls.join('\n')).toContain(
			`pnpm josh issue:comment ${FINDER} --body '${NOTE}'`,
		)
	})

	it('single-quotes a title carrying shell syntax in the re-run', async () => {
		try_comment.mockResolvedValue(false)

		await issue_file_deferral.note_finder({
			...deferral_of(FINDER),
			title: 'Teach `josh gate` "x"',
		})

		expect(error.mock.calls.join('\n')).toContain(
			`--body '${issue_file_deferral.NOTE_PREFIX} ${REFERENCE} Teach \`josh gate\` "x"'`,
		)
	})
})
