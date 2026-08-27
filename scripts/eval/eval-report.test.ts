import { describe, expect, it, vi } from 'vitest'
import type { Verdict } from './eval-judge'
import { eval_report } from './eval-report'

function verdict(name: string, is_pass: boolean, is_inconclusive: boolean): Verdict {
	return {
		name,
		rule: 'a rule',
		is_pass,
		is_inconclusive,
		note: undefined,
		failures: [],
		calls: [],
	}
}

const HELD = verdict('held', true, false)
const FAILED = verdict('failed', false, false)
const INCONCLUSIVE = verdict('inconclusive', false, true)
const BLOCKED_LINE = 'Verdict: blocked'

describe('eval_report.merge_verdict', () => {
	it('holds when every scenario passed', () => {
		expect(eval_report.merge_verdict([HELD, HELD])).toBe(eval_report.VERDICT_HELD)
	})

	// The distinction the exit code cannot carry: a failed run and one that measured nothing both
	// exit non-zero, and only the first is a reason to stop a merge.
	it('blocks on a failed scenario', () => {
		expect(eval_report.merge_verdict([HELD, FAILED])).toBe(eval_report.VERDICT_BLOCKED)
	})

	it('reports an inconclusive run as unmeasured rather than blocking', () => {
		expect(eval_report.merge_verdict([HELD, INCONCLUSIVE])).toBe(eval_report.VERDICT_UNMEASURED)
	})

	// One measured violation is a fact about the rules however many of its neighbors said nothing.
	it('lets a failure outrank an inconclusive verdict', () => {
		expect(eval_report.merge_verdict([INCONCLUSIVE, FAILED])).toBe(eval_report.VERDICT_BLOCKED)
	})

	// Not `unmeasured`: that verdict does not block, and a suite that found nothing to run has
	// measured nothing at all — a pruned install would otherwise print a green-looking last line.
	it('blocks on a run of no scenarios', () => {
		expect(eval_report.merge_verdict([])).toBe(eval_report.VERDICT_BLOCKED)
	})
})

describe('eval_report.report_merge_verdict', () => {
	it('prints the verdict token with the sentence that says what it means', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(eval_report.report_merge_verdict([FAILED])).toBe(eval_report.VERDICT_BLOCKED)
		expect(info.mock.calls.at(0)?.at(0)).toContain(BLOCKED_LINE)
		expect(info.mock.calls.at(0)?.at(0)).toContain('before merging')

		info.mockRestore()
	})
})

describe('eval_report.report_not_run', () => {
	// A run the suite could not act on must not read as `unmeasured`: that verdict does not block a
	// merge, and this path is reached by a typo in the re-run a `blocked` verdict asked for.
	it('answers blocked rather than unmeasured', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(eval_report.report_not_run()).toBe(eval_report.VERDICT_BLOCKED)
		expect(info.mock.calls.at(0)?.at(0)).toContain(BLOCKED_LINE)

		info.mockRestore()
	})
})
