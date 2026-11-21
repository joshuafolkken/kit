import {
	auto_ok_fixture,
	CREATED_EARLIER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import { epic_solo } from '#scripts/epic/epic-solo'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import {
	AUTO_OK_LABEL,
	BUG_LABEL,
	INTERRUPT_ROUTE_LABEL,
	RUN_LANE_LABEL,
	RUN_SOLO_LABEL,
} from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_interrupt } from './backlog-interrupt'
import { backlog_next } from './backlog-next'

// joshuafolkken/kit#7860: an interrupt defect filed as needing a person carries no `auto-ok`, so it
// sat outside the pool while lanes kept launching. It now holds the backlog until it is judged.

const { console_streams } = auto_ok_fixture

const ROWS = [811, 812]
const INTERRUPT = 839
const GATE_BODY = 'Every run fails the Security Audit in `.github/workflows/`.'
const OTHER_BODY = 'A typo in `docs/how-to/run-backlog.md`.'

const streams = console_streams()
const { stdout, stderr } = streams

function interrupt(labels: ReadonlyArray<string>, body = GATE_BODY): OpenIssueData {
	return {
		...auto_ok_fixture.issue(INTERRUPT, CREATED_EARLIER, [
			BUG_LABEL,
			INTERRUPT_ROUTE_LABEL,
			...labels,
		]),
		body,
	}
}

function stub(interrupts: ReadonlyArray<OpenIssueData>): void {
	backlog_fixture.stub_backlog({
		opted_in: ROWS.map((number) =>
			auto_ok_fixture.issue(number, CREATED_EARLIER, [AUTO_OK_LABEL, RUN_LANE_LABEL]),
		),
		interrupts,
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

describe('backlog:next with an interrupt defect outside the pool', () => {
	it('offers no lane and asks for triage while a gate-path interrupt is untriaged', async () => {
		stub([interrupt([])])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.triage)
		expect(stderr()).toContain(String(INTERRUPT))
		expect(backlog_interrupt.is_decision_wait(stderr())).toBe(true)
	})

	it('offers no lane while a run:solo interrupt without auto-ok waits for a person', async () => {
		stub([interrupt([RUN_SOLO_LABEL])])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.wait)
		expect(backlog_interrupt.is_decision_wait(stderr())).toBe(true)
	})

	it('never says a pending interrupt is running or releases when parked', async () => {
		stub([interrupt([RUN_SOLO_LABEL])])
		await backlog_next.run([])

		expect(epic_solo.is_solo_wait(stderr())).toBe(false)
		expect(stderr()).not.toContain('parked')
	})

	it.each([
		['judged run:lane', interrupt([RUN_LANE_LABEL])],
		['naming no verification-gate path', interrupt([], OTHER_BODY)],
		['already opted in', interrupt([AUTO_OK_LABEL])],
	])('offers the backlog as usual for an interrupt %s', async (_name, row) => {
		stub([row])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(offered()).toStrictEqual(ROWS)
	})
})
