import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_cut, type RunCut } from './run-cut'
import { run_cut_handoff } from './run-cut-handoff'
import { run_cut_report } from './run-cut-report'

const RECORD: RunCut = {
	invocation: 'fullrun #2989',
	issue: '2989',
	branch: '2989-lane',
	phase: 'pre-gate',
	cut_at: '2026-10-03T00:00:00.000Z',
}

const { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE } = run_cut_report

const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

beforeEach(() => {
	info_spy.mockClear()
	error_spy.mockClear()
})

function stderr_text(): string {
	return error_spy.mock.calls.map((call) => String(call[0])).join('\n')
}

function expect_verdict(verdict: string): void {
	expect(info_spy.mock.calls).toStrictEqual([[verdict]])
}

describe('run_cut_report — verdict tokens', () => {
	it('pins the resume and cut tokens', () => {
		expect([
			run_cut_report.CUT_VERDICT,
			run_cut_report.RESUME_VERDICT,
			run_cut_report.RESUME_IMPL_VERDICT,
			run_cut_report.FRESH_VERDICT,
			run_cut_report.UNDER_THRESHOLD_VERDICT,
			run_cut_report.HANDED_OFF_VERDICT,
			run_cut_report.NOT_A_LANE_VERDICT,
			run_cut_report.ENDED_VERDICT,
		]).toStrictEqual([
			'cut',
			'resume',
			'resume-impl',
			'fresh',
			'under-threshold',
			'handed-off',
			'not-a-lane',
			'ended',
		])
	})
})

describe('run_cut_report — refusal tokens and exit codes', () => {
	it('pins the refusal tokens', () => {
		expect([
			run_cut_report.STALE_VERDICT,
			run_cut_report.INCOMPLETE_VERDICT,
			run_cut_report.BAD_HANDOFF_VERDICT,
			run_cut_report.BUSY_VERDICT,
			run_cut_report.UNREADY_VERDICT,
			run_cut_report.FAILED_VERDICT,
			run_cut_report.UNREADABLE_VERDICT,
			run_cut_report.UNKNOWN_VERDICT,
			run_cut_report.OVER_VERDICT,
		]).toStrictEqual([
			'stale',
			'incomplete',
			'bad-handoff',
			'busy',
			'unready',
			'failed',
			'unreadable',
			'unknown',
			'over',
		])
	})

	it('uses 0 for success and 1 for failure', () => {
		expect([SUCCESS_EXIT_CODE, FAILURE_EXIT_CODE]).toStrictEqual([0, 1])
	})
})

describe('run_cut_report.report', () => {
	it('prints exactly the verdict on stdout and returns the given code', () => {
		expect(run_cut_report.report(run_cut_report.CUT_VERDICT, SUCCESS_EXIT_CODE)).toBe(
			SUCCESS_EXIT_CODE,
		)
		expect_verdict(run_cut_report.CUT_VERDICT)
		expect(error_spy).not.toHaveBeenCalled()
	})
})

describe('run_cut_report — record-carrying failures explain on stderr with the run_cut message', () => {
	it.each([
		{ report: run_cut_report.report_stale, message: run_cut.stale_message, verdict: 'stale' },
		{ report: run_cut_report.report_busy, message: run_cut.busy_message, verdict: 'busy' },
		{
			report: run_cut_report.report_incomplete,
			message: run_cut.incomplete_message,
			verdict: 'incomplete',
		},
	])('prints $verdict and fails', ({ report, message, verdict }) => {
		expect(report(RECORD)).toBe(FAILURE_EXIT_CODE)
		expect_verdict(verdict)
		expect(error_spy.mock.calls).toStrictEqual([[message(RECORD)]])
	})

	it('report_handed_off is a benign success', () => {
		expect(run_cut_report.report_handed_off(RECORD)).toBe(SUCCESS_EXIT_CODE)
		expect_verdict(run_cut_report.HANDED_OFF_VERDICT)
		expect(error_spy.mock.calls).toStrictEqual([[run_cut.handed_off_message(RECORD)]])
	})
})

describe('run_cut_report — record-less reports', () => {
	it.each([
		{
			report: run_cut_report.report_unreadable,
			message: run_cut.unreadable_message(),
			verdict: 'unreadable',
		},
		{
			report: run_cut_report.report_unknown,
			message: run_cut.unknown_message(),
			verdict: 'unknown',
		},
	])('prints $verdict and fails with the run_cut message', ({ report, message, verdict }) => {
		expect(report()).toBe(FAILURE_EXIT_CODE)
		expect_verdict(verdict)
		expect(error_spy.mock.calls).toStrictEqual([[message]])
	})

	it('report_under_threshold is a benign success that sends the run on to the gate', () => {
		expect(run_cut_report.report_under_threshold()).toBe(SUCCESS_EXIT_CODE)
		expect_verdict(run_cut_report.UNDER_THRESHOLD_VERDICT)
		expect(stderr_text()).toContain('under the shared cut threshold')
		expect(stderr_text()).toContain('Continue to the gate.')
	})

	it('report_over fails and tells the person to start a fresh session', () => {
		expect(run_cut_report.report_over()).toBe(FAILURE_EXIT_CODE)
		expect_verdict(run_cut_report.OVER_VERDICT)
		expect(stderr_text()).toContain('`pnpm josh cost --cut` answers `over`')
		expect(stderr_text()).toContain('fresh session')
	})
})

describe('run_cut_report.report_bad_handoff', () => {
	it.each([run_cut_report.HANDOFF_OVERFLOW_NOTE, run_cut_report.HANDOFF_MISSING_NOTE])(
		'prefixes the note "%s" to the nothing-was-cut instruction',
		(note) => {
			expect(run_cut_report.report_bad_handoff(note)).toBe(FAILURE_EXIT_CODE)
			expect_verdict(run_cut_report.BAD_HANDOFF_VERDICT)
			expect(error_spy.mock.calls).toStrictEqual([
				[
					`${note}. Nothing was cut; write the handoff file at ${run_cut_handoff.HANDOFF_PATH} and reissue.`,
				],
			])
		},
	)

	it('pins both handoff notes', () => {
		expect(run_cut_report.HANDOFF_OVERFLOW_NOTE).toBe(
			'--handoff <path> would grow the cut record past its byte bound',
		)
		expect(run_cut_report.HANDOFF_MISSING_NOTE).toBe(
			'this cut resumes into implementation and needs --handoff <path>',
		)
	})
})

describe('run_cut_report.refuse_unready', () => {
	it('names the branch and dirtiness and fails with unready', () => {
		const state = { branch: 'main', is_dirty: false, is_held: false }

		expect(run_cut_report.refuse_unready(state)).toBe(FAILURE_EXIT_CODE)
		expect_verdict(run_cut_report.UNREADY_VERDICT)
		expect(error_spy.mock.calls).toStrictEqual([
			[
				'Not ready to cut on main (dirty: false); a cut needs an uncommitted lane branch. Nothing was cut.',
			],
		])
	})
})
