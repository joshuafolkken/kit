import { git_gh_command } from '#scripts/gh/git-gh-command'
import { listing_outcome } from '#scripts/gh/git-gh-issue-list-fixture'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { issue_not_before_label } from './issue-not-before-label'

// joshuafolkken/kit#4079: `not-before` is a copy of the body's start-time declaration — on while the
// time is ahead, off once it has passed or the declaration is gone.

const LABEL = 'not-before'
const NOW = Date.parse('2026-10-18T00:00Z')
const AHEAD = '## 背景\n\n- 実施可能日: 2026-10-20T00:00Z\n'
const PASSED = '## 背景\n\n- 実施可能日: 2026-10-17T00:00Z\n'
const UNDECLARED = '## 背景\n\n- 種別: 非不具合\n'
const LABELLED = [{ name: LABEL }]

type Write = typeof git_gh_issue_write

interface Writes {
	ensure: MockInstance<Write['label_ensure']>
	add: MockInstance<Write['issue_add_label']>
	remove: MockInstance<Write['issue_remove_label']>
}

function stub_writes(): Writes {
	return {
		ensure: vi.spyOn(git_gh_issue_write, 'label_ensure').mockResolvedValue(),
		add: vi.spyOn(git_gh_issue_write, 'issue_add_label').mockResolvedValue(true),
		remove: vi.spyOn(git_gh_issue_write, 'issue_remove_label').mockResolvedValue(),
	}
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_not_before_label.change_of', () => {
	it.each([
		['adds to a body whose time is ahead', AHEAD, [], 'add'],
		['keeps the label on a body whose time is ahead', AHEAD, [LABEL], undefined],
		['removes it once the time has passed', PASSED, [LABEL], 'remove'],
		['removes it once the declaration is gone', UNDECLARED, ['Not-Before'], 'remove'],
		['leaves a body that declares nothing', UNDECLARED, [], undefined],
	])('%s', (_label, body, labels, expected) => {
		expect(issue_not_before_label.change_of(body, labels, NOW)).toBe(expected)
	})
})

describe('issue_not_before_label.sync', () => {
	it('creates the label before adding it, and removes it where it is no longer owed', async () => {
		const writes = stub_writes()
		const issues = [
			{ number: 1, body: AHEAD },
			{ number: 2, body: PASSED, labels: LABELLED },
			{ number: 3, body: AHEAD, labels: LABELLED },
		]

		await issue_not_before_label.sync(issues, NOW)

		expect(writes.ensure).toHaveBeenCalledWith(expect.objectContaining({ name: LABEL }))
		expect(writes.ensure.mock.invocationCallOrder[0]).toBeLessThan(
			writes.add.mock.invocationCallOrder[0] ?? 0,
		)
		expect(writes.add.mock.calls).toStrictEqual([['1', LABEL]])
		expect(writes.remove.mock.calls).toStrictEqual([['2', LABEL]])
	})

	it('creates nothing when no issue owes the label', async () => {
		const writes = stub_writes()

		await issue_not_before_label.sync([{ number: 2, body: PASSED, labels: LABELLED }], NOW)

		expect(writes.ensure).not.toHaveBeenCalled()
		expect(writes.remove).toHaveBeenCalledOnce()
	})
})

// The `not-before` listing's answer; `undefined` is a listing that could not be read.
function stub_labelled(rows?: ReadonlyArray<{ number: number; body: string }>): void {
	vi.spyOn(git_gh_command, 'issue_list_by_label').mockResolvedValue(
		listing_outcome(rows === undefined ? undefined : JSON.stringify(rows)),
	)
}

describe('issue_not_before_label.sweep', () => {
	it('removes the label from an issue the scan never read once its time has passed', async () => {
		const writes = stub_writes()

		stub_labelled([{ number: 4, body: PASSED }])
		await issue_not_before_label.sweep([{ number: 1, body: AHEAD }], NOW)

		expect(writes.add.mock.calls).toStrictEqual([['1', LABEL]])
		expect(writes.remove.mock.calls).toStrictEqual([['4', LABEL]])
	})

	it('writes a scanned issue the label listing also returns once', async () => {
		const writes = stub_writes()

		stub_labelled([{ number: 2, body: PASSED }])
		await issue_not_before_label.sweep([{ number: 2, body: PASSED, labels: LABELLED }], NOW)

		expect(writes.remove).toHaveBeenCalledOnce()
	})

	it('syncs the scanned issues alone when the label listing cannot be read', async () => {
		const writes = stub_writes()

		stub_labelled()
		await issue_not_before_label.sweep([{ number: 2, body: PASSED, labels: LABELLED }], NOW)

		expect(writes.remove.mock.calls).toStrictEqual([['2', LABEL]])
	})
})

describe('issue_not_before_label.sync — a write that fails', () => {
	it('warns on a failed removal rather than throwing', async () => {
		const writes = stub_writes()
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		writes.remove.mockRejectedValue(new Error('HTTP 403'))
		await issue_not_before_label.sync([{ number: 2, body: PASSED, labels: LABELLED }], NOW)

		expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not remove'))
	})

	it('warns on an addition GitHub did not apply', async () => {
		const writes = stub_writes()
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		writes.add.mockResolvedValue(false)
		await issue_not_before_label.sync([{ number: 1, body: AHEAD }], NOW)

		expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not add'))
	})
})
