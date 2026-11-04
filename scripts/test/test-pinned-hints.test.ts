import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { test_pinned_logic, type PinnedReport } from './test-pinned-logic'
import { test_pinned_record } from './test-pinned-record'

const ROOT = `/nonexistent/test-pinned-hints-${randomUUID()}`
const TOKEN = 'hints'
const HUNK = { file: 'driver.ts', new_start: 4, new_count: 1, old_lines: [], is_green: true }
const REPORT: PinnedReport = {
	unpinned: [{ ...HUNK, related_tests: ['driver.test.ts', 'importer.test.ts'] }],
	stopped: [],
	unchecked: [HUNK],
	unparsed: [],
	max_hunks: 1,
	has_runner: true,
}
const EXPECTED =
	'unpinned driver.ts:4 — reverting it left every related test green; related tests: driver.test.ts, importer.test.ts; strengthen a regression assertion that fails when this change is reverted'

afterEach(() => {
	test_pinned_record.clear(TOKEN, ROOT)
})

describe('test:pinned regression hints', () => {
	it('names the location, candidate tests and an assertion that detects the revert', () => {
		expect(test_pinned_logic.format(REPORT).split('\n', 1)[0]).toBe(EXPECTED)
		expect(test_pinned_logic.report_parts(REPORT).text.split('\n', 1)[0]).toBe(EXPECTED)
	})

	it('asks for a related regression test when none exists', () => {
		const report = { ...REPORT, unpinned: [{ ...HUNK, is_green: false, related_tests: [] }] }

		expect(test_pinned_logic.format(report).split('\n', 1)[0]).toBe(
			'unpinned driver.ts:4 — no related test ran with it reverted; no related tests; add a related regression test that fails when this change is reverted',
		)
	})

	it('distinguishes unavailable candidates from an empty related-test graph', () => {
		const report = { ...REPORT, unpinned: [HUNK] }

		expect(test_pinned_logic.format(report)).toContain(
			'related tests unavailable; add or strengthen a regression test',
		)
	})

	it('keeps hints in the full log, recorded display and partial display', () => {
		const summary = test_pinned_record.summary_of(REPORT, ROOT)
		const path = summary.log?.path ?? ''

		test_pinned_record.write(TOKEN, summary, ROOT)
		expect(readFileSync(path, 'utf8')).toContain(EXPECTED)
		expect(test_pinned_record.read(TOKEN, ROOT)?.text).toContain(EXPECTED)
		expect(test_pinned_record.partial_summary(REPORT, 'NOTE').text).toContain(EXPECTED)
		rmSync(path, { force: true })
	})
})
