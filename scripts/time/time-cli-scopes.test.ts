import { describe, expect, it, vi } from 'vitest'
import { time_batch } from './time-batch'
import { time_cli } from './time-cli'
import { time_cli_fixture } from './time-cli-fixture'
import { time_distribution } from './time-distribution'
import { time_epic, type EpicTimeReport } from './time-epic'
import { time_last, type LastTimeReport } from './time-last'
import { time_report } from './time-report'

// The two scopes that report several runs at once (joshuafolkken/kit#1271, joshuafolkken/kit#1312).
//
// Its own file rather than more of `time-cli.test.ts`, which is at the line ceiling; the console
// capture and the one run report both suites assert against are `time-cli-fixture.ts`'s, so neither
// restates what the command was handed.

const { CWD, MINUTE_MS, RUN_MINUTES, CI_MINUTES, ISSUE, RUN_REPORT, output, errors } =
	time_cli_fixture

time_cli_fixture.capture_console()

const EPIC = 1272
const EPIC_SCOPE = `epic #${String(EPIC)}`
const LAST_COUNT = 5
const LAST_SCOPE = 'the last 1 merged run(s)'
const LAST_FLAG = '--last'
const CI_MS = CI_MINUTES * MINUTE_MS

const MEASURED_ROW = {
	issue_number: ISSUE,
	status: 'measured',
	ms_per_turn: MINUTE_MS,
	report: RUN_REPORT,
} as const

const EPIC_REPORT: EpicTimeReport = {
	scope: EPIC_SCOPE,
	epic_number: EPIC,
	children: [{ ...MEASURED_ROW }],
	total_ms: RUN_MINUTES * MINUTE_MS,
	categories: RUN_REPORT.categories,
	has_transcript_data: true,
	has_ci_data: true,
	timed_count: 1,
	measured_count: 1,
	unmeasured_count: 0,
	trend: { is_comparable: false, first_ms_per_turn: 0, last_ms_per_turn: 0, child_count: 1 },
	notes: [],
}

const LAST_REPORT: LastTimeReport = {
	scope: LAST_SCOPE,
	requested_count: LAST_COUNT,
	runs: [{ ...MEASURED_ROW }],
	measured_count: 1,
	unmeasured_count: 0,
	collapsed_pulls: [],
	elapsed: time_distribution.build([RUN_MINUTES * MINUTE_MS]),
	categories: [time_distribution.labeled(time_report.MODEL_LABEL, [MINUTE_MS])],
	phases: [],
	checks: [],
	notes: [],
}

describe('time_cli.run — one epic', () => {
	it('reports the batch child by child under --epic', async () => {
		vi.spyOn(time_epic, 'build_epic_report').mockResolvedValue(EPIC_REPORT)

		expect(await time_cli.run(['--epic', String(EPIC)], CWD)).toBe(0)
		expect(output()).toContain(EPIC_SCOPE)
		expect(output()).toContain(`#${String(ISSUE)}`)
	})

	// The acceptance criterion the whole scope exists for: `--json` carries per child what `--issue`
	// carries for one run, breakdown included, rather than only the batch's headline figures.
	it('carries each child’s own breakdown under --json', async () => {
		vi.spyOn(time_epic, 'build_epic_report').mockResolvedValue(EPIC_REPORT)
		await time_cli.run(['--epic', String(EPIC), '--json'], CWD)

		expect(JSON.parse(output())).toMatchObject({
			scope: EPIC_SCOPE,
			children: [{ issue_number: ISSUE, report: { categories: { ci_ms: CI_MS }, phases: [] } }],
		})
	})

	// An unreadable epic is a failure, not an empty batch: reporting "0 children" would assert
	// something nobody established.
	it('fails rather than reporting an empty batch when the epic could not be read', async () => {
		vi.spyOn(time_epic, 'build_epic_report').mockResolvedValue(undefined)

		expect(await time_cli.run(['--epic', String(EPIC)], CWD)).toBe(1)
		expect(errors()).toContain(time_cli.NO_EPIC)
		expect(output()).toBe('')
	})
})

// A child whose report could not be built at all. The row is `failed` rather than `not run`, which is
// what the exit code below is read off (joshuafolkken/kit#1352).
const FAILED_ROW = { ...MEASURED_ROW, status: time_batch.FAILED } as const
const FAILED_EPIC: EpicTimeReport = {
	...EPIC_REPORT,
	children: [{ ...FAILED_ROW }],
	timed_count: 0,
	measured_count: 0,
	unmeasured_count: 1,
}
const FAILED_LAST: LastTimeReport = {
	...LAST_REPORT,
	runs: [{ ...FAILED_ROW }],
	measured_count: 0,
	unmeasured_count: 1,
}

// The acceptance criterion of the Issue's first symptom: a regression that made every child throw
// printed a plausible table and exited 0, so nothing downstream could tell the run from a good one.
describe('time_cli.run — a batch holding a report that failed to build', () => {
	it('exits non-zero under --epic and still prints the table', async () => {
		vi.spyOn(time_epic, 'build_epic_report').mockResolvedValue(FAILED_EPIC)

		expect(await time_cli.run(['--epic', String(EPIC)], CWD)).toBe(1)
		expect(output()).toContain(time_batch.FAILED)
	})

	it('exits non-zero under --last too', async () => {
		vi.spyOn(time_last, 'build_last_report').mockResolvedValue(FAILED_LAST)

		expect(await time_cli.run([LAST_FLAG, String(LAST_COUNT)], CWD)).toBe(1)
		expect(output()).toContain(time_batch.FAILED)
	})

	// A child the batch never reached is an ordinary answer and must not fail the command — otherwise
	// every epic with an unstarted child would exit non-zero.
	it('keeps exiting zero for a child the batch simply never reached', async () => {
		const not_run: EpicTimeReport = {
			...FAILED_EPIC,
			children: [{ ...MEASURED_ROW, status: time_batch.NOT_RUN }],
		}

		vi.spyOn(time_epic, 'build_epic_report').mockResolvedValue(not_run)

		expect(await time_cli.run(['--epic', String(EPIC)], CWD)).toBe(0)
	})
})

describe('time_cli.run — the last N runs', () => {
	it('reports the distribution under --last', async () => {
		vi.spyOn(time_last, 'build_last_report').mockResolvedValue(LAST_REPORT)

		expect(await time_cli.run([LAST_FLAG, String(LAST_COUNT)], CWD)).toBe(0)
		expect(output()).toContain(LAST_SCOPE)
		expect(output()).toContain(time_report.MODEL_LABEL)
	})

	// The same acceptance criterion `--epic` has: `--json` carries per run what `--issue` carries for
	// one, so a caller can rank off the runs the distribution was taken from.
	it('carries each run’s own breakdown under --json', async () => {
		vi.spyOn(time_last, 'build_last_report').mockResolvedValue(LAST_REPORT)
		await time_cli.run([LAST_FLAG, String(LAST_COUNT), '--json'], CWD)

		expect(JSON.parse(output())).toMatchObject({
			scope: LAST_SCOPE,
			runs: [{ issue_number: ISSUE, report: { categories: { ci_ms: CI_MS } } }],
		})
	})

	// Never an empty distribution: zeroes would read as a repository whose runs all took no time.
	it('fails rather than reporting an empty distribution when no run resolved', async () => {
		vi.spyOn(time_last, 'build_last_report').mockResolvedValue(undefined)

		expect(await time_cli.run([LAST_FLAG, String(LAST_COUNT)], CWD)).toBe(1)
		expect(errors()).toContain(time_cli.NO_RUNS)
		expect(output()).toBe('')
	})
})
