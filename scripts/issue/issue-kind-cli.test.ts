import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_kind_cli } from './issue-kind-cli'

const { issue_get_labels_and_body, issue_edit_body, issue_add_label, issue_clear_label } =
	vi.hoisted(() => ({
		issue_get_labels_and_body: vi.fn<(issue: string) => Promise<string | undefined>>(),
		issue_edit_body: vi.fn<(issue: string, body: string) => Promise<string>>(),
		issue_add_label: vi.fn<(issue: string, label: string) => Promise<boolean>>(),
		issue_clear_label: vi.fn<(issue: string, label: string) => Promise<boolean>>(),
	}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		issue_get_labels_and_body,
		issue_edit_body,
		issue_add_label,
		issue_clear_label,
	},
}))

const ISSUE = '7974'
const NON_BUG = 'non-bug'
const PURPOSE = '--purpose'
const RELEASE_CLASS = '--release-class'
const OTHER_CHANGE = 'other-change'
const IN_PROGRESS = 'in-progress'
const HEAD =
	'## 概要\n\nx\n\n## 背景\n\n- 優先度: 通常\n- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）\n'
const TAIL = '\n## 現象\n\nx\n\n## 期待結果\n\nx\n\n## 受け入れ条件\n\n- [ ] x\n'
const FEATURE = `${HEAD}- 種別: 非不具合\n- 目的: 機能追加\n${TAIL}`
const DEFECT = `${HEAD}- 種別: 不具合\n- 原因: #12\n${TAIL}`
const OTHER = `${HEAD}- 種別: 非不具合\n- リリース分類: other-change\n${TAIL}`
const TO_BUG = [ISSUE, 'bug', '--origin', '#12']
const TO_FEATURE = [ISSUE, NON_BUG, PURPOSE, 'feature']

function issue_json(body: string, labels: ReadonlyArray<string>): string {
	return JSON.stringify({
		number: 1,
		state: 'OPEN',
		body,
		labels: labels.map((name) => ({ name })),
	})
}

function given(body: string, labels: ReadonlyArray<string>): void {
	issue_get_labels_and_body.mockResolvedValue(issue_json(body, labels))
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	issue_edit_body.mockResolvedValue('https://github.com/o/r/issues/7974')
	issue_add_label.mockResolvedValue(true)
	issue_clear_label.mockResolvedValue(true)
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.resetAllMocks()
})

describe('issue_kind_cli.run switches', () => {
	it('passes dispatcher arguments through the executable entry', async () => {
		given(FEATURE, ['enhancement'])

		expect(await main_entry_fixture.run_entry('scripts/issue/issue-kind-cli.ts', TO_BUG)).toBe(0)
		expect(issue_edit_body).toHaveBeenCalledExactlyOnceWith(ISSUE, DEFECT)
	})

	it('switches a feature to a defect in the body and the labels (ac-50c1230b)', async () => {
		given(FEATURE, ['enhancement', 'auto-ok'])

		expect(await issue_kind_cli.run(TO_BUG)).toBe(0)
		expect(issue_edit_body).toHaveBeenCalledExactlyOnceWith(ISSUE, DEFECT)
		expect(issue_add_label).toHaveBeenCalledExactlyOnceWith(ISSUE, 'bug')
		expect(issue_clear_label).toHaveBeenCalledExactlyOnceWith(ISSUE, 'enhancement')
	})

	it('switches a defect to a feature (ac-59c5d20c)', async () => {
		given(DEFECT, ['bug'])

		expect(await issue_kind_cli.run(TO_FEATURE)).toBe(0)
		expect(issue_edit_body).toHaveBeenCalledExactlyOnceWith(ISSUE, FEATURE)
		expect(issue_add_label).toHaveBeenCalledExactlyOnceWith(ISSUE, 'enhancement')
		expect(issue_clear_label).toHaveBeenCalledExactlyOnceWith(ISSUE, 'bug')
	})

	it('switches a defect to other-change, adding no kind label (ac-59c5d20c)', async () => {
		given(DEFECT, ['bug'])

		expect(await issue_kind_cli.run([ISSUE, NON_BUG, RELEASE_CLASS, OTHER_CHANGE])).toBe(0)
		expect(issue_edit_body).toHaveBeenCalledExactlyOnceWith(ISSUE, OTHER)
		expect(issue_add_label).not.toHaveBeenCalled()
		expect(issue_clear_label).toHaveBeenCalledExactlyOnceWith(ISSUE, 'bug')
	})
})

describe('issue_kind_cli.run repeats (ac-f2b57901)', () => {
	it('writes nothing when the issue is already switched', async () => {
		given(DEFECT, ['bug'])

		expect(await issue_kind_cli.run(TO_BUG)).toBe(0)
		expect(issue_edit_body).not.toHaveBeenCalled()
		expect(issue_add_label).not.toHaveBeenCalled()
		expect(issue_clear_label).not.toHaveBeenCalled()
	})

	it('fails on a label write and settles the labels alone on the re-run', async () => {
		given(FEATURE, ['enhancement'])
		issue_add_label.mockResolvedValueOnce(false)

		expect(await issue_kind_cli.run(TO_BUG)).toBe(1)
		given(DEFECT, ['enhancement'])
		issue_edit_body.mockClear()

		expect(await issue_kind_cli.run(TO_BUG)).toBe(0)
		expect(issue_edit_body).not.toHaveBeenCalled()
		expect(issue_clear_label).toHaveBeenLastCalledWith(ISSUE, 'enhancement')
	})
})

describe('issue_kind_cli.run lint refusal (ac-1bc56c38)', () => {
	it('writes nothing for an unknown origin with no reproduction and names the next step', async () => {
		given(FEATURE, ['enhancement'])

		expect(await issue_kind_cli.run([ISSUE, 'bug', '--origin', '不明（調査中）'])).toBe(1)
		expect(issue_edit_body).not.toHaveBeenCalled()
		expect(issue_add_label).not.toHaveBeenCalled()
		expect(issue_clear_label).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('issue:body 7974'))
	})
})

describe('issue_kind_cli.run in-progress warning (ac-ed0e111d)', () => {
	it('warns after switching an in-progress issue to a defect', async () => {
		given(FEATURE, ['enhancement', IN_PROGRESS])

		expect(await issue_kind_cli.run(TO_BUG)).toBe(0)
		expect(issue_edit_body).toHaveBeenCalledOnce()
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('now need'))
	})

	it('warns after switching an in-progress issue to a non-defect', async () => {
		given(DEFECT, ['bug', IN_PROGRESS])

		expect(await issue_kind_cli.run(TO_FEATURE)).toBe(0)
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no longer need'))
	})

	it('does not warn without in-progress or when the kind stays', async () => {
		given(FEATURE, ['enhancement'])

		expect(await issue_kind_cli.run(TO_BUG)).toBe(0)
		given(DEFECT, ['bug', IN_PROGRESS])

		expect(await issue_kind_cli.run(TO_BUG)).toBe(0)
		expect(console.warn).not.toHaveBeenCalled()
	})
})

describe('issue_kind_cli.run refusals', () => {
	it.each(
		[
			[ISSUE, 'bug'],
			[ISSUE, 'bug', PURPOSE, 'feature', '--origin', '#1'],
			[ISSUE, NON_BUG],
			[ISSUE, NON_BUG, PURPOSE, 'feature', RELEASE_CLASS, OTHER_CHANGE],
			[ISSUE, NON_BUG, PURPOSE, 'speed'],
			[ISSUE, NON_BUG, RELEASE_CLASS, 'enhancement'],
			[ISSUE, NON_BUG, '--origin', '#1', PURPOSE, 'feature'],
			[ISSUE, 'defect', '--origin', '#1'],
			['abc', 'bug', '--origin', '#1'],
			[ISSUE],
		].map((args) => ({ args })),
	)('refuses $args with the usage', async ({ args }) => {
		expect(await issue_kind_cli.run(args)).toBe(1)
		expect(issue_get_labels_and_body).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Usage: josh issue:kind'))
	})

	it('refuses an unreadable issue', async () => {
		issue_get_labels_and_body.mockResolvedValue(undefined)

		expect(await issue_kind_cli.run(TO_BUG)).toBe(1)
		expect(issue_edit_body).not.toHaveBeenCalled()
	})
})
