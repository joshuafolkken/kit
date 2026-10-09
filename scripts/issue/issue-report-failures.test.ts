import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_report_failures } from './issue-report-failures'
import { session_cite } from './session-cite'

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const TERMS = { success_kind: 'state', misreading: 'the issue is open' } as const

const error_spy = vi.fn()
const info_spy = vi.fn()

beforeEach(() => {
	error_spy.mockReset()
	info_spy.mockReset()
	vi.spyOn(console, 'error').mockImplementation(error_spy)
	vi.spyOn(console, 'info').mockImplementation(info_spy)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_report_failures.report_failures', () => {
	it('exits zero and prints nothing when every number answered with the success kind', () => {
		const reports = [{ issue_number: '1', result: { kind: 'state' as const } }]

		expect(issue_report_failures.report_failures(reports, TERMS)).toBe(SUCCESS_EXIT_CODE)
		expect(error_spy).not.toHaveBeenCalled()
	})

	it('names every failed number and exits non-zero', () => {
		const reports = [
			{ issue_number: '1', result: { kind: 'missing' as const } },
			{ issue_number: '2', result: { kind: 'state' as const } },
			{ issue_number: '3', result: { kind: 'unreadable' as const } },
		]

		expect(issue_report_failures.report_failures(reports, TERMS)).toBe(FAILURE_EXIT_CODE)
		expect(error_spy).toHaveBeenCalledTimes(2)
		expect(error_spy).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining(`${session_cite.issue(1)} does not resolve`),
		)
		expect(error_spy).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining(`could not read issue ${session_cite.issue(3)}`),
		)
	})

	it('says what an unreadable number must not be mistaken for', () => {
		const reports = [{ issue_number: '7', result: { kind: 'unreadable' as const } }]

		issue_report_failures.report_failures(reports, { success_kind: 'issue', misreading: 'empty' })

		expect(error_spy).toHaveBeenCalledWith(expect.stringContaining('This is not "empty"'))
	})
})

describe('issue_report_failures.print_blocks', () => {
	it('joins the blocks with the separator in one print', () => {
		issue_report_failures.print_blocks(['a', 'b'], '\n---\n', 'label')

		expect(info_spy).toHaveBeenCalledExactlyOnceWith('a\n---\nb')
	})

	it('prints nothing when there is no block', () => {
		issue_report_failures.print_blocks([], '\n', 'label')

		expect(info_spy).not.toHaveBeenCalled()
	})
})
