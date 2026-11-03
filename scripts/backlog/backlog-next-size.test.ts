import {
	auto_ok_fixture,
	CREATED_EARLIER,
	EPIC_NUMBER,
	OLD_ISSUE_NUMBER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { RUN_LANE_LABEL, SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { issue_sample_gate } from '#scripts/issue/issue-sample-gate'
import type { ImplementRate } from '#scripts/lane/lane-implement-rate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'
import { backlog_next_size } from './backlog-next-size'

// joshuafolkken/kit#5384: an offered Issue whose declared estimate is over the split guide says so on
// stderr, judged as `issue:file` judges it; the stdout token stays a bare number.

const { issue, opted_in_epic, console_streams } = auto_ok_fixture
const CHILD = 901

// joshuafolkken/kit#5654: the guide and the cap judge the declaration doubled.
const OVER_NOTE =
	'size estimate 6 file(s) / 150 line(s) × 2 = 12 file(s) / 300 line(s) exceeds the guide'

const streams = console_streams()
const { stdout, stderr } = streams

const CAP_NOTE =
	'not offered: size estimate 25 file(s) / 150 line(s) × 2 = 50 file(s) / 300 line(s) exceeds the cap'
const REASON = '- 分割しない理由: 1 コミットで入れる'
const REPO = 'joshuafolkken/kit'
// The doubled declaration projects over the implement budget at the slow rate, within it at the fast.
const SLOW: ImplementRate = { median: 10, lanes: 4 }
const FAST: ImplementRate = { median: 1, lanes: 3 }
const BUDGET_NOTE = 'projected over the implement budget'

function sized_at(files: number, ...lines: ReadonlyArray<string>): OpenIssueData {
	const declared = `- 規模見積もり: 約 ${String(files)} ファイル / 150 行（テスト除く）`
	const body = ['## 背景', '', declared, ...lines].join('\n')

	return { ...issue(OLD_ISSUE_NUMBER, CREATED_EARLIER), body }
}

function sized(...lines: ReadonlyArray<string>): OpenIssueData {
	return sized_at(6, ...lines)
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
		backlog_fixture.stub_backlog({ opted_in: [sized(REASON)] })
		await backlog_next.run([])

		expect(stderr()).not.toContain(OVER_NOTE)
	})

	// joshuafolkken/kit#5935: a split child passes the guide at filing, yet is warned on when offered.
	it('offers a split child over the guide and notes it to split further', async () => {
		const child = { ...sized(REASON), labels: [{ name: SPLIT_ROUTE_LABEL }] }

		backlog_fixture.stub_backlog({ opted_in: [child] })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
		expect(stderr()).toContain(OVER_NOTE)
		expect(stderr()).toContain(`on a \`${SPLIT_ROUTE_LABEL}\` child — split it further`)
	})

	it('notes nothing on a split child within the guide', async () => {
		const within = '- 規模見積もり: 約 4 ファイル / 100 行（テスト除く）'
		const body = ['## 背景', '', within].join('\n')
		const child = { ...sized(), body, labels: [{ name: SPLIT_ROUTE_LABEL }] }

		backlog_fixture.stub_backlog({ opted_in: [child] })
		await backlog_next.run([])

		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
		expect(stderr()).not.toContain('exceeds the guide')
	})
})

// joshuafolkken/kit#6066: the reason excuses the guide, not the projected implement budget.
describe('backlog:next with a measured implement rate', () => {
	it('notes a reasoned issue projected over the implement budget', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized(REASON)], implement_rate: SLOW })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
		expect(stderr()).toContain(OVER_NOTE)
		expect(stderr()).toContain(BUDGET_NOTE)
	})

	it('notes nothing on a reasoned issue within the implement budget', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized(REASON)], implement_rate: FAST })
		await backlog_next.run([])

		expect(stderr()).not.toContain(OVER_NOTE)
	})

	it('keeps the guide note on an unreasoned issue', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized()], implement_rate: SLOW })
		await backlog_next.run([])

		expect(stderr()).toContain('with no `- 分割しない理由:`')
		expect(stderr()).not.toContain(BUDGET_NOTE)
	})
})

// joshuafolkken/kit#5502: past the cap the issue is not offered, reason or not.
describe('backlog:next with an estimate over the size cap', () => {
	it('withholds the issue and says why, despite a declared reason', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized_at(25, REASON)] })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.stop)
		expect(stderr()).toContain(CAP_NOTE)
	})

	it('notes nothing on an excluded issue', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized_at(25)] })
		await backlog_next.run(['--exclude', String(OLD_ISSUE_NUMBER)])

		expect(stderr()).not.toContain(CAP_NOTE)
	})

	it('offers the issue at the cap itself', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized_at(6, REASON)] })
		await backlog_next.run([])

		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
		expect(stderr()).not.toContain('exceeds the cap')
	})
})

function epic_child(files: number, labels: ReadonlyArray<string>): EpicChild {
	const { body } = sized_at(files, REASON)

	return { number: OLD_ISSUE_NUMBER, repo: REPO, state: 'OPEN', labels, blocked_by: [], body }
}

describe('backlog:next with an epic child over the size cap', () => {
	it('holds the child for a person and says why', async () => {
		const body = sized_at(25, REASON).body ?? ''

		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic()],
			epics: [{ number: EPIC_NUMBER, children: [CHILD] }],
			children: [{ number: CHILD, labels: [RUN_LANE_LABEL], body }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.stop)
		expect(stderr()).toContain(CAP_NOTE)
	})
})

describe('backlog_next_size.held_children', () => {
	it('holds an open epic child over the cap and notes it', () => {
		const over = epic_child(25, [])

		expect(backlog_next_size.held_children([over])).toEqual(new Set([epic_graph.key_of(over)]))
		expect(stderr()).toContain(CAP_NOTE)
	})

	it('holds neither a child at the cap nor a split child over it', () => {
		const held = backlog_next_size.held_children([
			epic_child(6, []),
			epic_child(25, [SPLIT_ROUTE_LABEL]),
		])

		expect(held.size).toBe(0)
	})
})
