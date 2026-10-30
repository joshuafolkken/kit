import {
	auto_ok_fixture,
	CREATED_EARLIER,
	OLD_ISSUE_NUMBER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { issue_sample_gate } from '#scripts/issue/issue-sample-gate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'

// joshuafolkken/kit#5384: an offered Issue whose declared estimate is over the split guide says so on
// stderr, judged as `issue:file` judges it; the stdout token stays a bare number.

const { issue, console_streams } = auto_ok_fixture

const OVER_NOTE = 'size estimate 12 file(s) / 300 line(s) exceeds the guide'

const streams = console_streams()
const { stdout, stderr } = streams

function sized(...lines: ReadonlyArray<string>): OpenIssueData {
	const body = [
		'## 背景',
		'',
		'- 規模見積もり: 約 12 ファイル / 300 行（テスト除く）',
		...lines,
	].join('\n')

	return { ...issue(OLD_ISSUE_NUMBER, CREATED_EARLIER), body }
}

beforeEach(() => {
	vi.restoreAllMocks()
	issue_sample_gate.reset()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	vi.spyOn(git_gh_issue_write, 'label_ensure').mockResolvedValue()
	vi.spyOn(git_gh_issue_write, 'issue_add_label').mockResolvedValue(true)
	vi.spyOn(git_gh_issue_write, 'issue_remove_label').mockResolvedValue()
	streams.reset()
})

describe('backlog:next with an estimate over the split guide', () => {
	it('offers the issue and notes it is over the guide', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized()] })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
		expect(stderr()).toContain(OVER_NOTE)
		expect(stderr()).toContain('split-assessment.md → "The question"')
	})

	it('notes nothing when the body says why it stays one Issue', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized('- 分割しない理由: 1 コミットで入れる')] })
		await backlog_next.run([])

		expect(stderr()).not.toContain(OVER_NOTE)
	})

	it('notes nothing on a split child', async () => {
		const child = { ...sized(), labels: [{ name: SPLIT_ROUTE_LABEL }] }

		backlog_fixture.stub_backlog({ opted_in: [child] })
		await backlog_next.run([])

		expect(stderr()).not.toContain(OVER_NOTE)
	})
})
