import { describe, expect, it, vi } from 'vitest'
import type { Verdict } from './eval-judge'
import { eval_report } from './eval-report'

function verdict(
	name: string,
	is_pass: boolean,
	is_inconclusive: boolean,
	is_unreachable = false,
): Verdict {
	return {
		name,
		rule: 'a rule',
		is_pass,
		is_inconclusive,
		is_unreachable,
		note: undefined,
		failures: [],
		calls: [],
	}
}

const HELD = verdict('held', true, false)
const FAILED = verdict('failed', false, false)
const INCONCLUSIVE = verdict('inconclusive', false, true)
const UNREACHABLE = verdict('unreachable', false, true, true)
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

	// joshuafolkken/kit#1197: "the sessions ran and told us nothing" and "the sessions never ran" are
	// different things to be told, and merging them sent every reader to check a harness that was
	// fine.
	it('names an unreachable API rather than calling it unmeasured', () => {
		expect(eval_report.merge_verdict([HELD, UNREACHABLE])).toBe(eval_report.VERDICT_UNREACHABLE)
	})

	// A measured violation still outranks it: the connection failing elsewhere does not unmake a rule
	// that was measured and broken here.
	it('lets a failure outrank an unreachable API', () => {
		expect(eval_report.merge_verdict([UNREACHABLE, FAILED])).toBe(eval_report.VERDICT_BLOCKED)
	})

	// The narrower answer wins, because it is the one that names what to fix.
	it('names the unreachable API beside an ordinary non-measurement', () => {
		expect(eval_report.merge_verdict([INCONCLUSIVE, UNREACHABLE])).toBe(
			eval_report.VERDICT_UNREACHABLE,
		)
	})
})

describe('eval_report.report_summary', () => {
	it('counts an unreachable session apart from an ordinary non-measurement', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		eval_report.report_summary([HELD, INCONCLUSIVE, UNREACHABLE])

		expect(info.mock.calls.at(0)?.at(0)).toContain('1 inconclusive')
		expect(info.mock.calls.at(0)?.at(0)).toContain('1 could not reach the API')

		info.mockRestore()
	})

	it('says nothing about either count when every scenario held', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		eval_report.report_summary([HELD, HELD])

		expect(info.mock.calls.at(0)?.at(0)).toBe('\n2/2 scenarios held.')

		info.mockRestore()
	})
})

describe('eval_report.report_verdict', () => {
	// A `?` line sends the reader to the harness or the prompt; an unreachable session says nothing
	// about either, so it is printed apart rather than under the same mark.
	it('sends an unreachable session somewhere other than the harness', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		eval_report.report_verdict(UNREACHABLE)

		expect(error.mock.calls.at(1)?.at(0)).toContain('nothing was attempted')

		error.mockRestore()
	})

	it('still sends an ordinary non-measurement to the harness', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		eval_report.report_verdict(INCONCLUSIVE)

		expect(error.mock.calls.at(1)?.at(0)).toContain('fix the harness or the prompt')

		error.mockRestore()
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

// The seam a caller needs when it has to print something *above* the verdict line: the sentence is
// still single-sourced, so the split cannot let the two spellings drift.
describe('eval_report.print_verdict', () => {
	it('prints the same line report_merge_verdict does', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		eval_report.print_verdict(eval_report.merge_verdict([UNREACHABLE]))
		eval_report.report_merge_verdict([UNREACHABLE])

		expect(info.mock.calls.at(0)?.at(0)).toBe(info.mock.calls.at(1)?.at(0))
		expect(info.mock.calls.at(0)?.at(0)).toContain('Verdict: unreachable')

		info.mockRestore()
	})

	// The word is reached by **one** refused session and the suite only stops starting sessions at two,
	// so the sentence has to say what one refusal proves. Asserting that it did not measure everything
	// is true of every unreachable run; asserting that the rest were never started is false whenever
	// exactly one session was refused — and CLAUDE.md tells an agent to carry this sentence verbatim
	// into the completion report.
	it('does not claim the remaining sessions went unstarted', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		eval_report.print_verdict(eval_report.merge_verdict([HELD, UNREACHABLE]))

		const line = String(info.mock.calls.at(0)?.at(0))

		expect(line).not.toContain('the remaining sessions were not started')
		expect(line).toContain('once two are refused')

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
