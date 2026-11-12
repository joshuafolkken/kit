import { RUN_LANE_LABEL, RUN_SOLO_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it, vi } from 'vitest'
import { backlog_triage_decision } from './backlog-triage-decision'

const YES = 'yes'
const NO = 'no'
const UNKNOWN = 'unknown'
const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

function argv(defect: string, verification: string, every_run: string): ReadonlyArray<string> {
	return ['--defect', defect, '--verification', verification, '--every-run', every_run]
}

describe('the three solo conditions', () => {
	it.each([
		[YES, YES, YES, RUN_SOLO_LABEL],
		[NO, YES, YES, RUN_LANE_LABEL],
		[YES, NO, YES, RUN_LANE_LABEL],
		[YES, YES, NO, RUN_LANE_LABEL],
		[UNKNOWN, YES, YES, 'judge'],
		[YES, UNKNOWN, YES, 'judge'],
		[YES, YES, UNKNOWN, 'judge'],
		[NO, UNKNOWN, UNKNOWN, RUN_LANE_LABEL],
	])('%s / %s / %s answers %s', (defect, verification, every_run, answer) => {
		expect(backlog_triage_decision.run(argv(defect, verification, every_run))).toBe(0)
		expect(info).toHaveBeenCalledExactlyOnceWith(answer)
	})

	it.each([
		{ args: [] },
		{ args: argv('maybe', YES, YES) },
		{ args: ['--defect', YES] },
		{ args: [...argv(YES, YES, YES), '--force'] },
	])('refuses incomplete or invalid evidence: $args', ({ args }) => {
		expect(backlog_triage_decision.run(args)).toBe(1)
		expect(info).not.toHaveBeenCalled()
		expect(error).toHaveBeenCalledOnce()
	})
})
