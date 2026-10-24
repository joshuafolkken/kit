import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type { PinnedReport } from './test-pinned-logic'
import { test_pinned_record } from './test-pinned-record'

// joshuafolkken/kit#4770: the answer `josh test:pinned --record` leaves for `josh run:review --join`.

const ROOT = `/nonexistent/test-pinned-record-${randomUUID()}`
const TOKEN = 'launch-1'
const EARLIER_TOKEN = 'launch-0'
const HUNK = { file: 'a.ts', new_start: 4, new_count: 1, old_lines: [], is_green: true }
const REPORT: PinnedReport = {
	unpinned: [HUNK],
	unchecked: [],
	unparsed: [],
	max_hunks: 20,
	has_runner: true,
}

afterEach(() => {
	test_pinned_record.clear(TOKEN, ROOT)
	test_pinned_record.clear(EARLIER_TOKEN, ROOT)
})

describe('test_pinned_record', () => {
	it('reduces a report to its printed text and its unpinned count', () => {
		expect(test_pinned_record.summary_of(REPORT)).toStrictEqual({
			text: 'unpinned 1 · unchecked 0\nunpinned a.ts:4 — reverting it left every related test green\n',
			unpinned_count: 1,
		})
	})

	it('reads back what it wrote, keyed to the checkout', () => {
		const summary = test_pinned_record.summary_of(REPORT)

		test_pinned_record.write(TOKEN, summary, ROOT)

		expect(test_pinned_record.read(TOKEN, ROOT)).toStrictEqual(summary)
		expect(test_pinned_record.read(TOKEN, `${ROOT}-other`)).toBeUndefined()
	})

	it("reads nothing of another launch's answer", () => {
		test_pinned_record.write(EARLIER_TOKEN, test_pinned_record.summary_of(REPORT), ROOT)

		expect(test_pinned_record.read(TOKEN, ROOT)).toBeUndefined()
	})

	it("keeps this launch's answer when an earlier launch's check writes after it", () => {
		const summary = test_pinned_record.summary_of(REPORT)

		test_pinned_record.write(TOKEN, summary, ROOT)
		test_pinned_record.write(EARLIER_TOKEN, test_pinned_record.not_run_summary('late'), ROOT)

		expect(test_pinned_record.read(TOKEN, ROOT)).toStrictEqual(summary)
	})

	it('reads nothing once cleared, or from a record that is not a summary', () => {
		test_pinned_record.write(TOKEN, test_pinned_record.not_run_summary('gone'), ROOT)
		test_pinned_record.clear(TOKEN, ROOT)

		expect(test_pinned_record.read(TOKEN, ROOT)).toBeUndefined()

		writeFileSync(test_pinned_record.record_path(TOKEN, ROOT), `{"token":"${TOKEN}","text":1}`)

		expect(test_pinned_record.read(TOKEN, ROOT)).toBeUndefined()

		writeFileSync(test_pinned_record.record_path(TOKEN, ROOT), 'not json')

		expect(test_pinned_record.read(TOKEN, ROOT)).toBeUndefined()
	})
})
