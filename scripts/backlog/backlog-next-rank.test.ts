import {
	auto_ok_fixture,
	CREATED_EARLIER,
	EPIC_NUMBER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import {
	AUTO_OK_LABEL,
	BUG_LABEL,
	IN_PROGRESS_LABEL,
	PRIORITY_HIGH_LABEL,
	RUN_SOLO_LABEL,
} from '#scripts/git/issue-labels'
import type { OpenIssueData } from '#scripts/git/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'

// joshuafolkken/kit#2928: the standalone offer is ranked, gated by run:solo and only then capped, so a
// run:solo issue ranked sixth or lower is seen by the gate rather than cut before it.

const { console_streams, opted_in_epic } = auto_ok_fixture

// One timestamp, so the recency order is the number order, highest first.
const ROWS = [807, 806, 805, 804, 803, 802, 801]
const SIXTH = 802
const SEVENTH = 801
const HOLDER = 950
const OFFER_CAP = 5
const EPIC_CHILD = 901

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
	it('offers priority:high first, then a verification-path defect, then the recency order', async () => {
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
})
