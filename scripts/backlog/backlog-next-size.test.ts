import {
	auto_ok_fixture,
	CREATED_EARLIER,
	EPIC_NUMBER,
	OLD_ISSUE_NUMBER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { IN_PROGRESS_LABEL, RUN_LANE_LABEL, SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
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
const SLOW: ImplementRate = { median: 3.75, lanes: 4 }
const FAST: ImplementRate = { median: 0.75, lanes: 3 }
const BUDGET_NOTE = 'projected over the implement budget'
const HELD_REMEDY = 'split it and file the parts again, or declare `- 分割しない理由: <理由>`'
const MEASURED_GUIDE_NOTE = 'more than 9.6 files or 240 lines'
const EXCEEDS_CAP = 'exceeds the cap'
const EXCEEDS_GUIDE = 'exceeds the guide'
const WAITING_ON_PERSON = 'Waiting on a person'

function sized_at(files: number, ...lines: ReadonlyArray<string>): OpenIssueData {
	const declared = `- 規模見積もり: 約 ${String(files)} ファイル / 150 行（テスト除く）`
	const body = ['## 背景', '', declared, ...lines].join('\n')

	return { ...issue(OLD_ISSUE_NUMBER, CREATED_EARLIER), body }
}

function sized(...lines: ReadonlyArray<string>): OpenIssueData {
	return sized_at(6, ...lines)
}

function stub_open_blocker(): void {
	vi.mocked(git_gh_command.issue_get_state_and_relations_classified).mockResolvedValue({
		kind: 'read',
		json: JSON.stringify({
			number: CHILD,
			state: 'OPEN',
			labels: [{ name: RUN_LANE_LABEL }],
			author_association: 'OWNER',
			blockedBy: { nodes: [{ number: OLD_ISSUE_NUMBER, state: 'OPEN' }], totalCount: 1 },
		}),
	})
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
	it('offers measured growth within the guide without a speed measurement', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized()], growth: { files: 1, lines: 1 } })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
		expect(stderr()).not.toContain(EXCEEDS_GUIDE)
		expect(stderr()).not.toContain(EXCEEDS_CAP)
	})
})

describe('backlog:next over the guide', () => {
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
		expect(stderr()).not.toContain(EXCEEDS_GUIDE)
	})
})

// joshuafolkken/kit#7006: an unreasoned issue projected over the implement budget is withheld, as one
// over the cap is; the reason excuses the budget as it does the guide (joshuafolkken/kit#6602).
describe('backlog:next with a measured implement rate', () => {
	it('withholds an issue over the budget alone and says what to do', async () => {
		const body = '## 背景\n\n- 規模見積もり: 約 1 ファイル / 70 行（テスト除く）'

		backlog_fixture.stub_backlog({
			opted_in: [{ ...sized(), body }],
			implement_rate: { median: 10, lanes: 4 },
		})
		await backlog_next.run([])

		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.stop)
		expect(stderr()).toContain('not offered: size estimate 1 file(s) / 70 line(s)')
		expect(stderr()).toContain(BUDGET_NOTE)
		expect(stderr()).toContain(HELD_REMEDY)
	})

	it('notes nothing on a reasoned issue projected over the implement budget', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized(REASON)], implement_rate: SLOW })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
		expect(stderr()).not.toContain(OVER_NOTE)
		expect(stderr()).not.toContain(BUDGET_NOTE)
	})

	it('notes nothing on a reasoned issue within the implement budget', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized(REASON)], implement_rate: FAST })
		await backlog_next.run([])

		expect(stderr()).not.toContain(OVER_NOTE)
	})

	it('withholds an unreasoned issue over the guide and the budget', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized()], implement_rate: SLOW })
		await backlog_next.run([])

		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.stop)
		expect(stderr()).toContain(MEASURED_GUIDE_NOTE)
		expect(stderr()).toContain(BUDGET_NOTE)
	})
})

describe('backlog:next with measured size limits', () => {
	it('offers a large issue within the measured cap at a fast rate', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized_at(25)], implement_rate: FAST })
		await backlog_next.run([])

		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
		expect(stderr()).not.toContain(EXCEEDS_CAP)
		expect(stderr()).toContain('more than 48 files or 1200 lines')
	})

	it('withholds a measured over-cap issue and its dependent', async () => {
		const behind = auto_ok_fixture.blocked_issue(CHILD, CREATED_EARLIER, [
			{ number: OLD_ISSUE_NUMBER, state: 'OPEN' },
		])

		backlog_fixture.stub_backlog({
			opted_in: [sized_at(7), behind],
			implement_rate: { median: 10, lanes: 4 },
		})
		await backlog_next.run([])

		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.stop)
		expect(stderr()).toContain('exceeds the cap (more than 12 files or 300 lines)')
	})

	it('warns a split child with the measured guide while exempting it from the cap', async () => {
		const child = { ...sized_at(25), labels: [{ name: SPLIT_ROUTE_LABEL }] }

		backlog_fixture.stub_backlog({ opted_in: [child], implement_rate: { median: 2.5, lanes: 4 } })
		await backlog_next.run([])

		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
		expect(stderr()).toContain('more than 14.4 files or 360 lines')
		expect(stderr()).toContain('split it further')
		expect(stderr()).not.toContain(EXCEEDS_CAP)
	})
})

describe('backlog:next within the measured guide', () => {
	it.each([{ labels: [] }, { labels: [SPLIT_ROUTE_LABEL] }])(
		'does not warn a fast-rate issue with labels $labels',
		async ({ labels }) => {
			backlog_fixture.stub_backlog({
				opted_in: [{ ...sized(), labels: labels.map((name) => ({ name })) }],
				implement_rate: FAST,
			})
			await backlog_next.run([])

			expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
			expect(stderr()).not.toContain(EXCEEDS_GUIDE)
		},
	)
})

describe('backlog:next with a measured-cap blocker', () => {
	it('keeps a standalone dependent waiting on a large running issue', async () => {
		const behind = auto_ok_fixture.blocked_issue(CHILD, CREATED_EARLIER, [
			{ number: OLD_ISSUE_NUMBER, state: 'OPEN' },
		])
		const blocker = { ...sized_at(25), labels: [{ name: IN_PROGRESS_LABEL }] }

		backlog_fixture.stub_backlog({ opted_in: [blocker, behind], implement_rate: FAST })
		await backlog_next.run([])

		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.wait)
		expect(stderr()).not.toContain(WAITING_ON_PERSON)
	})

	it('keeps an epic child waiting on a large running standalone issue', async () => {
		const blocker = { ...sized_at(25), labels: [{ name: IN_PROGRESS_LABEL }] }

		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic(), blocker],
			epics: [{ number: EPIC_NUMBER, children: [CHILD] }],
			children: [{ number: CHILD, blocked_by: [OLD_ISSUE_NUMBER] }],
			implement_rate: FAST,
		})
		stub_open_blocker()
		await backlog_next.run([])

		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.wait)
		expect(stderr()).not.toContain(WAITING_ON_PERSON)
	})
})

// joshuafolkken/kit#5502: past the cap an issue with no declared reason is not offered.
describe('backlog:next with an estimate over the size cap', () => {
	it('withholds the issue with no reason declared and says why', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized_at(25)] })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.stop)
		expect(stderr()).toContain(CAP_NOTE)
	})

	// joshuafolkken/kit#6602: the declared reason is the pre-start decision, so it excuses the cap.
	it('offers the issue over the cap with a reason declared', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized_at(25, REASON)] })
		await backlog_next.run([])

		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
		expect(stderr()).not.toContain(EXCEEDS_CAP)
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
		expect(stderr()).not.toContain(EXCEEDS_CAP)
	})
})

function epic_child(files: number, labels: ReadonlyArray<string>): EpicChild {
	const { body } = sized_at(files)

	return { number: OLD_ISSUE_NUMBER, repo: REPO, state: 'OPEN', labels, blocked_by: [], body }
}

describe('backlog:next with an epic child over the size cap', () => {
	it('offers an epic child above the fixed cap at a fast measured rate', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic()],
			epics: [{ number: EPIC_NUMBER, children: [CHILD] }],
			children: [{ number: CHILD, labels: [RUN_LANE_LABEL], body: sized_at(25).body ?? '' }],
			implement_rate: FAST,
		})
		await backlog_next.run([])

		expect(stdout()).toBe(String(CHILD))
		expect(stderr()).not.toContain(EXCEEDS_CAP)
	})

	it('holds the child for a person and says why', async () => {
		const body = sized_at(25).body ?? ''

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
	it('uses the measured cap for epic children', () => {
		const over = epic_child(25, [])

		expect(backlog_next_size.held_children([over], FAST).size).toBe(0)
		expect(backlog_next_size.held_children([over], SLOW)).toEqual(
			new Set([epic_graph.key_of(over)]),
		)
		expect(stderr()).toContain('exceeds the cap (more than 14.399999999999999 files or 360 lines)')
	})

	it('holds an epic child within the cap projected over the budget (joshuafolkken/kit#7006)', () => {
		const over = epic_child(6, [])

		expect(backlog_next_size.held_children([over], SLOW).size).toBe(1)
		expect(stderr()).toContain(BUDGET_NOTE)
	})

	it('holds no reasoned epic child over the cap (joshuafolkken/kit#6602)', () => {
		const reasoned = { ...epic_child(25, []), body: sized_at(25, REASON).body ?? '' }

		expect(backlog_next_size.held_children([reasoned]).size).toBe(0)
	})

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
