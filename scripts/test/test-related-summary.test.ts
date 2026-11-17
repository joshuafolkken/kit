import { describe, expect, it } from 'vitest'
import { test_related_record, type RunInput } from './test-related-record'
import { related_scope, type RelatedScope } from './test-related-scope'
import { test_related_summary } from './test-related-summary'

// joshuafolkken/kit#7735: a run closes on how many test files it ran and the changed file that added
// the most of them.

const { COMMAND_LABEL } = related_scope
const WIDE_MODULE = 'scripts/wide.ts'
const NARROW_MODULE = 'scripts/narrow.ts'
const WIDE_TESTS = 580
const NARROW_TESTS = 24
const SELECTED = 604
const REACH = [
	{ file: NARROW_MODULE, count: NARROW_TESTS },
	{ file: WIDE_MODULE, count: WIDE_TESTS },
]
const RELATED: RelatedScope = { mode: 'related', files: [WIDE_MODULE], reason: '1 related file(s)' }
const NONE: RelatedScope = { mode: 'none', files: [], reason: 'nothing moved' }
const ALL: RelatedScope = { mode: 'all', files: [], reason: 'package.json affects every test' }

describe('test_related_summary.summary_line', () => {
	it('names the selected count and the changed file adding the most test files', () => {
		expect(test_related_summary.summary_line(RELATED, SELECTED, REACH)).toBe(
			`${COMMAND_LABEL}: ${String(SELECTED)} test file(s) selected, widest ${WIDE_MODULE} (+${String(WIDE_TESTS)})`,
		)
	})

	it('names no widest file where no reach was read', () => {
		expect(test_related_summary.summary_line(RELATED, SELECTED, [])).toBe(
			`${COMMAND_LABEL}: ${String(SELECTED)} test file(s) selected`,
		)
	})

	it('says no test file was selected for a run of no tests', () => {
		expect(test_related_summary.summary_line(NONE, undefined, REACH)).toBe(
			`${COMMAND_LABEL}: 0 test files selected`,
		)
	})

	it('says a full-suite run ran the whole unit suite', () => {
		expect(test_related_summary.summary_line(ALL, SELECTED, REACH)).toBe(
			`${COMMAND_LABEL}: ${String(SELECTED)} test file(s) selected — the full unit suite`,
		)
	})

	it('says the count went unreported where vitest wrote none', () => {
		expect(test_related_summary.summary_line(RELATED, undefined, [])).toContain(
			'an unreported number of test file(s) selected',
		)
	})
})

// The ledger row keeps what the line names, for a caller that cut the output.
describe('test_related_record.record_of — the widest changed file', () => {
	const input: RunInput = { scope: RELATED, root: '/', changed: [], synced: [], since_map: [] }

	it('records the file the closing line names and the test files it added', () => {
		const record = test_related_record.record_of(
			{ ...input, reach: REACH },
			{ elapsed_ms: 0, test_files: SELECTED },
		)
		const line = test_related_summary.summary_line(RELATED, record.test_files, REACH)

		expect(record).toMatchObject({ widest_file: WIDE_MODULE, widest_tests: WIDE_TESTS })
		expect(line).toContain(`widest ${String(record.widest_file)} (+${String(record.widest_tests)})`)
	})

	it('writes no widest file where no reach was read', () => {
		const record = test_related_record.record_of(input, { elapsed_ms: 0, test_files: undefined })

		expect(record).not.toHaveProperty('widest_file')
		expect(record).not.toHaveProperty('widest_tests')
	})
})

describe('test_related_summary.widest_of', () => {
	it('keeps the first of a tie and answers none for no reach', () => {
		const tie = [
			{ file: NARROW_MODULE, count: 1 },
			{ file: WIDE_MODULE, count: 1 },
		]

		expect(test_related_summary.widest_of(tie)?.file).toBe(NARROW_MODULE)
		expect(test_related_summary.widest_of(undefined)).toBeUndefined()
	})
})
