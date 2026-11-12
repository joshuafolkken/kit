import { describe, expect, it } from 'vitest'
import { test_pinned_logic, type Hunk, type PinnedReport } from './test-pinned-logic'
import { test_pinned_stage } from './test-pinned-stage'

// joshuafolkken/kit#5503: a hunk whose file reaches more test files than the cap is left unchecked
// rather than probed, and one within it is probed as before — a wide one direct importers first.

const { MAX_TEST_FILES } = test_pinned_logic
const AT_CAP = 'at-cap.ts'
const OVER_CAP = 'over-cap.ts'
const UNREAD = 'unread.ts'
const DIRECT = ['at-cap.test.ts']
const OVER_LINE = `unchecked ${OVER_CAP}:1 — over the ${String(MAX_TEST_FILES)}-test-file cap`
const REPORT: PinnedReport = {
	unpinned: [],
	stopped: [],
	unchecked: [],
	unparsed: [],
	max_hunks: 1,
	has_runner: true,
}

function hunk(file: string): Hunk {
	return { file, new_start: 1, new_count: 1, old_lines: [] }
}

const REACH = new Map([
	[AT_CAP, MAX_TEST_FILES],
	[OVER_CAP, MAX_TEST_FILES + 1],
])

describe('test_pinned_logic.capped', () => {
	it('checks a hunk whose file reaches the cap and leaves one past it unchecked', () => {
		expect(test_pinned_logic.capped([hunk(AT_CAP), hunk(OVER_CAP)], REACH)).toEqual({
			checked: [hunk(AT_CAP)],
			unchecked: [hunk(OVER_CAP)],
		})
	})

	it('checks a hunk whose file has no count read', () => {
		expect(test_pinned_logic.capped([hunk(UNREAD)], REACH).checked).toEqual([hunk(UNREAD)])
	})

	it('keeps the hunks in their order on each side', () => {
		const hunks = [hunk(OVER_CAP), hunk(AT_CAP), hunk(UNREAD), hunk(OVER_CAP)]

		expect(test_pinned_logic.capped(hunks, REACH)).toEqual({
			checked: [hunk(AT_CAP), hunk(UNREAD)],
			unchecked: [hunk(OVER_CAP), hunk(OVER_CAP)],
		})
	})

	it('runs a hunk at the cap direct importers first, the staged run left as it was', () => {
		expect(test_pinned_stage.plan_over(AT_CAP, DIRECT, MAX_TEST_FILES)).toEqual({
			direct: DIRECT,
			reach: [AT_CAP],
		})
	})
})

describe('test_pinned_logic over the test-file cap', () => {
	const report = { ...REPORT, over_cap: [hunk(OVER_CAP)] }

	it('lists each hunk over the cap as unchecked with the cap as its reason', () => {
		expect(test_pinned_logic.format(report)).toBe(OVER_LINE)
	})

	it('counts the hunks over the cap as unchecked, not unpinned', () => {
		const { counts, text } = test_pinned_logic.report_parts(report)

		expect(text).toBe(`unchecked 1 — over the ${String(MAX_TEST_FILES)}-test-file cap\n`)
		expect(counts).toBe('unpinned 0 · unchecked 1')
		expect(test_pinned_logic.has_unchecked(report)).toBe(true)
	})
})
