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
	stopped: [],
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
	it('reduces a report to its printed text and its unpinned places', () => {
		expect(test_pinned_record.summary_of(REPORT)).toStrictEqual({
			text: 'unpinned 1 · unchecked 0\nunpinned a.ts:4 — reverting it left every related test green\n',
			unpinned: [expect.stringMatching(/^a\.ts [\da-f]{16}$/u)],
		})
	})
})

const inserted = { ...HUNK, new_lines: ['console.log(x)'] }

function site(hunk: PinnedReport['unpinned'][number]): string | undefined {
	return test_pinned_record.summary_of({ ...REPORT, unpinned: [hunk] }).unpinned[0]
}

// joshuafolkken/kit#4775: a place keeps its key when merging the default branch in moves its line.
describe('test_pinned_record — the key of an unpinned place', () => {
	it('keys a place by its file, function and replaced lines, not its line', () => {
		const moved = site({ ...HUNK, new_start: 40 })

		expect(moved).toBe(site(HUNK))
		expect(site({ ...HUNK, old_lines: ['const a = 1'] })).not.toBe(moved)
		expect(site({ ...HUNK, function_name: 'run' })).toMatch(/^a\.ts run [\da-f]{16}$/u)
	})

	it('keys two insertions of one length apart by the lines they put in', () => {
		const logged = site(inserted)

		expect(site({ ...inserted, new_start: 40 })).toBe(logged)
		expect(site({ ...HUNK, new_lines: ['if (x === undefined) return'] })).not.toBe(logged)
	})

	it('keys a second identical insertion in the file apart from the first', () => {
		const copied = { ...inserted, new_start: 40 }
		const [first, second] = test_pinned_record.summary_of({
			...REPORT,
			unpinned: [inserted, copied],
		}).unpinned

		expect(first).toBe(site(inserted))
		expect(second).not.toBe(first)
	})
})

describe('test_pinned_record — the record', () => {
	it('reads back what it wrote, keyed to the checkout', () => {
		const summary = test_pinned_record.summary_of(REPORT)

		test_pinned_record.write(TOKEN, summary, ROOT)

		expect(test_pinned_record.read(TOKEN, ROOT)).toStrictEqual(summary)
		expect(test_pinned_record.read(TOKEN, `${ROOT}-other`)).toBeUndefined()
	})

	// joshuafolkken/kit#5153: a check cut at its first unpinned hunk is read back as one.
	it('reads back a cut answer as cut', () => {
		const summary = test_pinned_record.summary_of({ ...REPORT, cut: [HUNK] })

		test_pinned_record.write(TOKEN, summary, ROOT)

		expect(test_pinned_record.read(TOKEN, ROOT)?.is_cut).toBe(true)
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
