import {
	auto_ok_fixture,
	CREATED_EARLIER,
	EPIC_NUMBER,
	OLD_ISSUE_NUMBER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { issue_cap_files } from '#scripts/issue/issue-cap-files'
import { IN_PROGRESS_LABEL, RUN_LANE_LABEL, SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { issue_sample_gate } from '#scripts/issue/issue-sample-gate'
import type { ImplementRate } from '#scripts/lane/lane-implement-rate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'

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
	'size estimate 25 file(s) / 150 line(s) × 2 = 50 file(s) / 300 line(s) exceeds the cap'
const REASON = '- 分割しない理由: 1 コミットで入れる'
// The doubled declaration projects over the implement budget and within the size bar at the slow
// rate, within the budget at the fast; the bar rate projects it past the bar.
const SLOW: ImplementRate = { median: 3.75, lanes: 4 }
const FAST: ImplementRate = { median: 0.75, lanes: 3 }
const BAR_RATE: ImplementRate = { median: 10, lanes: 4 }
const BAR_NOTE = 'over the 18-minute size bar'
const NOT_OFFERED = 'not offered'
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

// joshuafolkken/kit#7184: an issue naming a file near its code-line cap is warned on and offered.
describe('backlog:next with a named file near its cap', () => {
	it('offers the issue and warns it names a file near its cap', async () => {
		const near = [{ file_path: 'a.ts', limit: 300, budget: undefined }]
		const cap_note = 'names a.ts near its cap'

		vi.spyOn(issue_cap_files, 'near_cap_by_body').mockResolvedValue([near])
		vi.spyOn(issue_cap_files, 'note').mockReturnValue(cap_note)
		backlog_fixture.stub_backlog({ opted_in: [sized(REASON)] })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
		expect(stderr()).toContain(cap_note)
	})
})

// joshuafolkken/kit#7074: an unreasoned issue projected over the size bar is offered with a note, never
// withheld; the reason excuses the bar as it does the guide (joshuafolkken/kit#6602).
describe('backlog:next with a measured implement rate', () => {
	it('offers an issue over the size bar alone and notes the bar', async () => {
		const body = '## 背景\n\n- 規模見積もり: 約 1 ファイル / 100 行（テスト除く）'

		backlog_fixture.stub_backlog({ opted_in: [{ ...sized(), body }], implement_rate: BAR_RATE })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
		expect(stderr()).toContain('size estimate 1 file(s) / 100 line(s)')
		expect(stderr()).toContain(`${BAR_NOTE} (2 × the 9-minute implement budget: at most 90`)
		expect(stderr()).not.toContain(NOT_OFFERED)
	})

	it('notes nothing on a reasoned issue projected over the size bar', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized(REASON)], implement_rate: BAR_RATE })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
		expect(stderr()).not.toContain(EXCEEDS_GUIDE)
		expect(stderr()).not.toContain(BAR_NOTE)
	})

	it('notes nothing on a reasoned issue within the implement budget', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized(REASON)], implement_rate: FAST })
		await backlog_next.run([])

		expect(stderr()).not.toContain(OVER_NOTE)
	})

	it('notes the guide alone on an issue past the implement budget within the size bar', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized()], implement_rate: SLOW })
		await backlog_next.run([])

		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
		expect(stderr()).toContain(MEASURED_GUIDE_NOTE)
		expect(stderr()).not.toContain(BAR_NOTE)
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

	it('offers a measured over-cap issue and notes the cap', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized_at(7)], implement_rate: BAR_RATE })
		await backlog_next.run([])

		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
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

// joshuafolkken/kit#7074: past the cap an issue with no declared reason is offered with a note — the
// lane's `lane:plan` splits it or keeps it one Issue.
describe('backlog:next with an estimate over the size cap', () => {
	it('offers the issue with no reason declared and notes the cap', async () => {
		backlog_fixture.stub_backlog({ opted_in: [sized_at(25)] })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
		expect(stderr()).toContain(CAP_NOTE)
		expect(stderr()).not.toContain(NOT_OFFERED)
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

	// joshuafolkken/kit#7074: an epic child over the cap is offered, not held for a person.
	it('offers an epic child over the cap at the fallback guide', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic()],
			epics: [{ number: EPIC_NUMBER, children: [CHILD] }],
			children: [{ number: CHILD, labels: [RUN_LANE_LABEL], body: sized_at(25).body ?? '' }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(CHILD))
		expect(stderr()).toContain(`#${String(CHILD)}`)
		expect(stderr()).toContain(CAP_NOTE)
	})
})
