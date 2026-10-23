import { MEASURED_LABEL } from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_measured_close } from './issue-measured-close'

// joshuafolkken/kit#4621: the drive closes a measured issue with the same writes `issue:measured`
// makes, and holds no tree of the issue's, so nothing is released.

const { issue_comment, issue_apply_label, issue_close, release, close_completed_epics } =
	vi.hoisted(() => ({
		issue_comment: vi.fn<(issue_number: string, body: string) => Promise<string>>(),
		issue_apply_label:
			vi.fn<
				(
					issue_number: string,
					label: string,
				) => Promise<{ is_applied: true } | { is_applied: false; reason: string }>
			>(),
		issue_close: vi.fn<(issue_number: string, comment: string | undefined) => Promise<boolean>>(),
		release: vi.fn<(argv: ReadonlyArray<string>) => Promise<number>>(),
		close_completed_epics: vi.fn<() => Promise<void>>(),
	}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_comment, issue_apply_label, issue_close },
}))

vi.mock('#scripts/run/hold/run-hold-cli', () => ({ run_hold_cli: { run: release } }))

vi.mock('#scripts/epic/epic-close', () => ({ epic_close: { close_completed_epics } }))

const ISSUE = '4599'
const EVIDENCE = '- 値: 3'
const calls: Array<string> = []

function recorded<T>(name: string, answer: T): () => Promise<T> {
	return async () => {
		calls.push(name)

		return answer
	}
}

beforeEach(() => {
	calls.length = 0
	issue_comment.mockReset().mockImplementation(recorded('comment', 'url'))
	issue_apply_label.mockReset().mockImplementation(recorded('label', { is_applied: true }))
	issue_close.mockReset().mockImplementation(recorded('close', true))
	close_completed_epics.mockReset().mockImplementation(recorded('epics', undefined))
	release.mockReset()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('issue_measured_close.close', () => {
	it('comments, labels, closes and settles the epics, releasing nothing', async () => {
		await expect(issue_measured_close.close(ISSUE, EVIDENCE)).resolves.toBe(true)
		expect(calls).toStrictEqual(['comment', 'label', 'close', 'epics'])
		expect(issue_comment).toHaveBeenCalledWith(ISSUE, EVIDENCE)
		expect(issue_apply_label).toHaveBeenCalledWith(ISSUE, MEASURED_LABEL)
		expect(release).not.toHaveBeenCalled()
	})

	it('closes nothing when the label is not applied', async () => {
		issue_apply_label.mockResolvedValue({ is_applied: false, reason: 'HTTP 404' })

		await expect(issue_measured_close.close(ISSUE, EVIDENCE)).resolves.toBe(false)
		expect(issue_close).not.toHaveBeenCalled()
	})
})
