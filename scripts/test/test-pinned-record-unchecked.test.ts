import { randomUUID } from 'node:crypto'
import { run_review_pinned } from '#scripts/run/review/run-review-pinned'
import { describe, expect, it } from 'vitest'
import type { PinnedReport } from './test-pinned-logic'
import { test_pinned_record } from './test-pinned-record'

const ROOT = `/nonexistent/pinned-unchecked-${randomUUID()}`
const UNREADABLE = 'history unreadable'
const HUNK = { file: 'history.ts', new_start: 1, new_count: 1, old_lines: [] }
const REPORT: PinnedReport = {
	unpinned: [],
	stopped: [HUNK],
	unchecked: [],
	unparsed: [],
	max_hunks: 1,
	has_runner: true,
}

describe('first-review unchecked evidence', () => {
	it('lists concrete unchecked places without writing the finished check log', () => {
		const summary = test_pinned_record.partial_summary(REPORT, 'pending')

		expect(summary.text).toContain('unchecked history.ts:1 — vitest stopped')
		expect(summary.text).toContain(test_pinned_record.UNCHECKED_NOTE)
		expect(summary.log).toBeUndefined()
		expect(summary.is_partial).toBe(true)
	})

	it('preserves unchecked state across the shared answer record', () => {
		const summary = test_pinned_record.partial_summary(REPORT, 'pending')

		test_pinned_record.write('unchecked', summary, ROOT)

		expect(test_pinned_record.read('unchecked', ROOT)?.is_unchecked).toBe(true)
		test_pinned_record.clear('unchecked', ROOT)
	})

	it('does not call an unchecked-only answer clear or accept it under a reason', () => {
		const summary = test_pinned_record.partial_summary(REPORT, 'pending')

		expect(run_review_pinned.verdict_of(summary, undefined).kind).toBe('unchecked')
		expect(run_review_pinned.verdict_of(summary, 'only logs').kind).toBe('unchecked')
	})

	it('does not call a failed check clear', () => {
		const summary = test_pinned_record.not_run_summary(new Error(UNREADABLE))
		const verdict = run_review_pinned.verdict_of(summary, undefined)

		expect(verdict.kind).toBe('unchecked')
		expect(verdict.text).toContain(UNREADABLE)
	})
})
