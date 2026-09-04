import { afterEach, describe, expect, it, vi } from 'vitest'
import { time_batch } from './time-batch'
import { time_corpus } from './time-corpus'
import { time_epic_fixture } from './time-epic-fixture'
import type { TimeReport } from './time-report'
import { time_run } from './time-run'

// How the batch drives its children (joshuafolkken/kit#1300).
//
// The check-run read is the one thing left that really is per child, and it used to be waited on one
// child at a time — 0.84 seconds a child, nearly half of a nine-child epic's 16.6 seconds. Running
// the children through `bounded_pool` changes when each answer arrives, so the two things that
// survive only if the batch is written correctly get a case each: the order of the rows, and what
// one broken child does to its siblings.
//
// Its own file rather than more of `time-epic.test.ts`, which is at the line ceiling; the fixtures
// both suites read are `time-epic-fixture.ts`'s, so neither restates what a child looks like.

const { report_of, body_of, batch_of, TRIO_ROWS, TRIO } = time_epic_fixture
const { FIRST_CHILD, SECOND_CHILD, THIRD_CHILD } = time_epic_fixture

const SLOW_MS = 20
const MID_MS = 10
const BRIEF_MS = 1
// The middle child, so a batch that stopped at the failure would lose the one after it as well as
// keeping the one before it.
const UNREADABLE = SECOND_CHILD
const GH_FAILURE = 'gh: not authenticated'

afterEach(() => {
	vi.restoreAllMocks()
})

async function pause(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms)
	})
}

// Each case scripts `build_run_report` itself rather than stubbing a fixed answer per child, because
// what is under test is how the batch *drives* it — the delay, or the throw — rather than what it
// hands back. The corpus is stubbed too: the real walk resolves against `homedir()`, which this
// suite never redirects, so calling through would read whoever runs it's own sessions.
function stub_child_runs(run: (issue_number: number) => Promise<TimeReport>): void {
	vi.spyOn(time_corpus, 'collect_for_issues').mockReturnValue(new Map())
	vi.spyOn(time_run, 'build_run_report').mockImplementation(
		async (issue_number: number) => await run(issue_number),
	)
}

function stub_one_failing_child(): void {
	stub_child_runs(async (issue_number: number) => {
		if (issue_number === UNREADABLE) throw new Error(GH_FAILURE)

		return report_of({ issue_number })
	})
}

describe('time_epic.build_epic_report — the children run concurrently', () => {
	// The point of the change: with the reads serial, only one child is ever outstanding.
	it('has more than one child outstanding at a time', async () => {
		let in_flight = 0
		let peak = 0

		stub_child_runs(async (issue_number: number) => {
			in_flight += 1
			peak = Math.max(peak, in_flight)
			await pause(BRIEF_MS)
			in_flight -= 1

			return report_of({ issue_number })
		})

		await batch_of(body_of(TRIO_ROWS))

		expect(peak).toBeGreaterThan(1)
	})

	// Completion order is the reverse of the body's here, so a batch collecting results as they
	// finished would report 103, 102, 101. None of the three has a measured start and
	// `in_execution_order` is a stable sort, so the order the pool hands over is the order printed.
	it('keeps the children in body order however they finished', async () => {
		const delays = new Map([
			[FIRST_CHILD, SLOW_MS],
			[SECOND_CHILD, MID_MS],
			[THIRD_CHILD, BRIEF_MS],
		])

		stub_child_runs(async (issue_number: number) => {
			await pause(delays.get(issue_number) ?? BRIEF_MS)

			return report_of({ issue_number })
		})

		const report = await batch_of(body_of(TRIO_ROWS))

		expect(report.children.map((child) => child.issue_number)).toEqual(TRIO)
	})
})

describe('time_epic.build_epic_report — one child that could not be read', () => {
	// `bounded_map` raises the first failure and returns nothing, so a throw that escaped the worker
	// would take the whole batch's measurements with it — eight children discarded for the ninth.
	it('keeps the other children measured when one child throws', async () => {
		stub_one_failing_child()

		const report = await batch_of(body_of(TRIO_ROWS))

		expect(report.children.map((child) => child.issue_number)).toEqual(TRIO)
		expect(report.measured_count).toBe(TRIO.length - 1)
	})

	// And the child that failed is reported as unmeasured with the reason, never as a run that took no
	// time — the distinction the whole module keeps.
	it('reports the child that threw as "not run", carrying the reason', async () => {
		stub_one_failing_child()

		const report = await batch_of(body_of(TRIO_ROWS))
		const failed = report.children.find((child) => child.issue_number === UNREADABLE)

		expect(failed?.status).toBe(time_batch.NOT_RUN)
		expect(failed?.report.elapsed_ms).toBe(0)
		expect(failed?.report.notes.join('\n')).toContain(GH_FAILURE)
	})
})
