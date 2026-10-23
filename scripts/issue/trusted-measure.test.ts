import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { describe, expect, it, vi } from 'vitest'
import { trusted_measure } from './trusted-measure'

// joshuafolkken/kit#4621: running a command an Issue body names, shared by `measure:rerun` and the
// drive's measurement declaration. The trust decision itself is covered by `measure-rerun-cli.test.ts`.

vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_view_json: vi.fn() },
}))

describe('trusted_measure.run_command', () => {
	it('answers the trimmed output of a command that succeeds', () => {
		expect(trusted_measure.run_command('echo " 3 "')).toStrictEqual({ kind: 'ok', output: '3' })
	})

	it('answers the message of a command that fails', () => {
		const run = trusted_measure.run_command('exit 3')

		expect(run.kind).toBe('failed')
		expect(trusted_measure.text_of(run)).toMatch(/^\(command failed: .+\)$/u)
	})
})

describe('trusted_measure.text_of', () => {
	it('prints the output of a run that succeeded as it is', () => {
		expect(trusted_measure.text_of({ kind: 'ok', output: '3' })).toBe('3')
	})
})

describe('trusted_measure.read_trusted_body', () => {
	it('refuses an issue it could not read', async () => {
		vi.mocked(git_gh_issue_read.issue_view_json).mockResolvedValue(undefined)

		const read = await trusted_measure.read_trusted_body('4621')

		expect(read.kind).toBe('refused')
	})
})
