import {
	auto_ok_fixture,
	CREATED_EARLIER,
	CREATED_LATER,
	EPIC_NUMBER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import {
	AUTO_OK_LABEL,
	BUG_LABEL,
	IN_PROGRESS_LABEL,
	PRIORITY_CRITICAL_LABEL,
	PRIORITY_HIGH_LABEL,
	RUN_SOLO_LABEL,
} from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'

// joshuafolkken/kit#2928: the standalone offer is ranked, gated by run:solo and only then capped, so a
// run:solo issue ranked sixth or lower is seen by the gate rather than cut before it.

const { console_streams, opted_in_epic } = auto_ok_fixture

// One timestamp, so oldest-first ties use the number order, lowest first.
const ROWS = [801, 802, 803, 804, 805, 806, 807]
const SIXTH = 806
const SEVENTH = 807
const HOLDER = 950
const OFFER_CAP = 5
const EPIC_CHILD = 901
const SMALL_ESTIMATE = '## 背景\n\n- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）'
const LARGE_ESTIMATE = '## 背景\n\n- 規模見積もり: 約 2 ファイル / 60 行（テスト除く）'

const streams = console_streams()
const { stdout } = streams

function row(number: number, labels: ReadonlyArray<string>): OpenIssueData {
	return auto_ok_fixture.issue(number, CREATED_EARLIER, [AUTO_OK_LABEL, ...labels])
}

function stub(labelled: ReadonlyMap<number, ReadonlyArray<string>>, is_busy: boolean): void {
	backlog_fixture.stub_backlog({
		opted_in: ROWS.map((number) => row(number, labelled.get(number) ?? [])),
		in_progress: is_busy
			? [auto_ok_fixture.issue(HOLDER, CREATED_EARLIER, [IN_PROGRESS_LABEL])]
			: [],
	})
}

function offered(): Array<number> {
	return stdout().split('\n').map(Number)
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	vi.spyOn(console, 'warn').mockImplementation(streams.error)
	streams.reset()
})

describe('backlog:next with a run:solo issue past the cap', () => {
	it('offers nothing past a sixth-ranked run:solo defect while a lane runs', async () => {
		stub(new Map([[SIXTH, [BUG_LABEL, RUN_SOLO_LABEL]]]), true)

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.wait)
	})

	it('offers only the rows ahead of a sixth-ranked run:solo issue, never the one below it', async () => {
		stub(new Map([[SIXTH, [RUN_SOLO_LABEL]]]), true)

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(offered()).toStrictEqual(ROWS.slice(0, OFFER_CAP))
		expect(offered()).not.toContain(SEVENTH)
	})

	// The epic half is merged ahead of the standalone rows, so priority:high is what ranks an epic child
	// below the sixth row — and only a gate that sees that row keeps the child back. Capped before the
	// gate, the run:solo row is gone and the child is offered past it.
	it('offers no epic child ranked below a sixth-ranked run:solo issue', async () => {
		const labelled = new Map([
			[SIXTH, [PRIORITY_HIGH_LABEL, RUN_SOLO_LABEL]],
			[SEVENTH, []],
		])

		backlog_fixture.stub_backlog({
			opted_in: [
				opted_in_epic(),
				...ROWS.map((number) => row(number, labelled.get(number) ?? [PRIORITY_HIGH_LABEL])),
			],
			epics: [{ number: EPIC_NUMBER, children: [EPIC_CHILD] }],
			children: [{ number: EPIC_CHILD }],
			in_progress: [auto_ok_fixture.issue(HOLDER, CREATED_EARLIER, [IN_PROGRESS_LABEL])],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(offered()).toStrictEqual(ROWS.slice(0, OFFER_CAP))
	})

	it('keeps a run:solo issue that is not a defect in its ranked place in an idle repository', async () => {
		stub(new Map([[SIXTH, [RUN_SOLO_LABEL]]]), false)

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(offered()).toStrictEqual(ROWS.slice(0, OFFER_CAP))
	})
})

describe('backlog:next ranking keys', () => {
	it('offers the older issue first when all ranking keys are equal', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [auto_ok_fixture.issue(SIXTH, CREATED_LATER, [AUTO_OK_LABEL]), row(SEVENTH, [])],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(offered()).toStrictEqual([SEVENTH, SIXTH])
	})
})

describe('backlog:next estimated size ranking keys', () => {
	it('offers smaller standalone estimates first (ac-3e8c1770)', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [
				{ ...row(SIXTH, []), body: LARGE_ESTIMATE },
				{ ...row(SEVENTH, []), body: SMALL_ESTIMATE },
			],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(offered()).toStrictEqual([SEVENTH, SIXTH])
	})

	it('offers smaller epic child estimates first (ac-ede537a2)', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic()],
			epics: [{ number: EPIC_NUMBER, children: [SIXTH, SEVENTH] }],
			children: [
				{ number: SIXTH, body: LARGE_ESTIMATE },
				{ number: SEVENTH, body: SMALL_ESTIMATE },
			],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(offered()).toStrictEqual([SEVENTH, SIXTH])
	})
})

describe('backlog:next estimated size precedence', () => {
	it('keeps more dependents ahead of smaller estimates (ac-745dc1d2)', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic()],
			epics: [{ number: EPIC_NUMBER, children: [SIXTH, SEVENTH, EPIC_CHILD] }],
			children: [
				{ number: SIXTH, body: LARGE_ESTIMATE },
				{ number: SEVENTH, body: SMALL_ESTIMATE },
				{ number: EPIC_CHILD, blocked_by: [SIXTH] },
			],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(offered()).toStrictEqual([SIXTH, SEVENTH])
	})

	it('offers declared estimates before missing estimates (ac-d38a52b0)', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [row(SIXTH, []), { ...row(SEVENTH, []), body: LARGE_ESTIMATE }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(offered()).toStrictEqual([SEVENTH, SIXTH])
	})
})

describe('backlog:next resumable ranking keys', () => {
	it.each(['stashed', 'paused', 'open_pr'] as const)(
		'offers %s work before fresh work',
		async (signal) => {
			backlog_fixture.stub_backlog({
				opted_in: [row(SIXTH, []), row(SEVENTH, [])],
				[signal]: [SEVENTH],
			})

			expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
			expect(offered()).toStrictEqual([SEVENTH, SIXTH])
		},
	)

	it.each([
		[PRIORITY_CRITICAL_LABEL, 'stashed'],
		[PRIORITY_HIGH_LABEL, 'stashed'],
		[PRIORITY_CRITICAL_LABEL, 'paused'],
		[PRIORITY_HIGH_LABEL, 'paused'],
		[PRIORITY_CRITICAL_LABEL, 'open_pr'],
		[PRIORITY_HIGH_LABEL, 'open_pr'],
	])('keeps %s ahead of %s work', async (priority, signal) => {
		backlog_fixture.stub_backlog({
			opted_in: [row(SIXTH, []), row(SEVENTH, [priority])],
			[signal]: [SIXTH],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(offered()[0]).toBe(SEVENTH)
	})
})

describe('backlog:next priority ranking keys', () => {
	it('offers priority:high first, then a verification-path defect, then oldest-first ties', async () => {
		stub(
			new Map([
				[SIXTH, [BUG_LABEL, RUN_SOLO_LABEL]],
				[SEVENTH, [PRIORITY_HIGH_LABEL]],
			]),
			false,
		)

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(offered()).toStrictEqual([SEVENTH])
	})

	// joshuafolkken/kit#4383: priority:critical is offered ahead of priority:high.
	it('offers priority:critical ahead of priority:high', async () => {
		stub(
			new Map([
				[SIXTH, [PRIORITY_HIGH_LABEL]],
				[SEVENTH, [PRIORITY_CRITICAL_LABEL]],
			]),
			false,
		)

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(offered()[0]).toBe(SEVENTH)
	})
})
