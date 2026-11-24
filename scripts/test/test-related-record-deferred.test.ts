import { describe, expect, it } from 'vitest'
import { test_related_cap } from './test-related-cap'
import { test_related_record, type RunInput } from './test-related-record'
import { test_related_record_fixture } from './test-related-record-fixture'
import type { Selection } from './test-related-select'

const { OWN_CHANGE, SYNCED_CHANGE, SINCE_MAP_CHANGE, READER_TEST, related_input } =
	test_related_record_fixture
const DEFERRED_FILES = ['scripts/a.test.ts', 'scripts/b.test.ts', 'scripts/c.test.ts']
const DEFERRED = DEFERRED_FILES.length
// A main merge reaching wider than the lane's own file, past the cap.
const WIDE_SYNC = {
	deferred: DEFERRED_FILES,
	reach: [
		{ file: SYNCED_CHANGE, count: 300 },
		{ file: SINCE_MAP_CHANGE, count: 250 },
		{ file: OWN_CHANGE, count: 200 },
	],
}
const RESULT = { elapsed_ms: 0, test_files: undefined }

// joshuafolkken/kit#7976: what the cap deferred to CI is counted, a run that kept the whole suite is not;
// joshuafolkken/kit#8893: a cut run lists the files beside the count, an uncut one lists none.
describe('test_related_record.record_of — the tests deferred past the cap', () => {
	it('counts the deferred tests, zero included, and leaves the count out of a whole-suite run', () => {
		const capped = { ...related_input(), deferred: DEFERRED_FILES }
		const uncapped = { ...related_input(), deferred: [] }

		expect(test_related_record.record_of(capped, RESULT).deferred).toBe(DEFERRED)
		expect(test_related_record.record_of(uncapped, RESULT).deferred).toBe(0)
		expect(test_related_record.record_of(related_input(), RESULT)).not.toHaveProperty('deferred')
	})

	it('lists the deferred files of a cut run, as many as it counts', () => {
		const record = test_related_record.record_of(
			{ ...related_input(), deferred: DEFERRED_FILES },
			RESULT,
		)

		expect(record.deferred_files).toEqual(DEFERRED_FILES)
		expect(record.deferred_files).toHaveLength(Number(record.deferred))
	})

	it('lists no files where the cap cut nothing or the run kept the whole suite', () => {
		const uncut = test_related_record.record_of({ ...related_input(), deferred: [] }, RESULT)

		expect(uncut).not.toHaveProperty('deferred_files')
		expect(test_related_record.record_of(related_input(), RESULT)).not.toHaveProperty(
			'deferred_files',
		)
	})
})

describe('test_related_record.record_of — the hub that put the run past the cap', () => {
	// joshuafolkken/kit#5756: a file a main merge or the map's tree brought in is no hub of the lane's run.
	it('picks the hub from the branch own change over a wider file main brought in', () => {
		const input: RunInput = { ...related_input(), branch: [OWN_CHANGE], ...WIDE_SYNC }
		const record = test_related_record.record_of(input, RESULT)

		expect(record).toMatchObject({ deferred: DEFERRED, over_cap_hub: OWN_CHANGE })
	})

	it('names no hub where nothing was deferred, none is own or none passes the cap alone', () => {
		const none = { ...related_input(), branch: [OWN_CHANGE], ...WIDE_SYNC, deferred: [] }
		const foreign = { ...related_input(), branch: [READER_TEST], ...WIDE_SYNC }
		const under = { ...none, deferred: DEFERRED_FILES, reach: [{ file: OWN_CHANGE, count: 150 }] }

		expect(test_related_record.record_of(none, RESULT)).not.toHaveProperty('over_cap_hub')
		expect(test_related_record.record_of(foreign, RESULT)).not.toHaveProperty('over_cap_hub')
		expect(test_related_record.record_of(under, RESULT)).not.toHaveProperty('over_cap_hub')
	})
})

// joshuafolkken/kit#6187: the record carries the count and the hub the run's summary line printed.
describe('test_related_record.record_of — the summary line of the same run', () => {
	it('records the count and the hub the summary line of the same run names', () => {
		const input: RunInput = { ...related_input(), branch: [OWN_CHANGE], ...WIDE_SYNC }
		const record = test_related_record.record_of(input, RESULT)
		const selection: Selection = {
			tests: [READER_TEST],
			deferred: DEFERRED_FILES,
			reach: WIDE_SYNC.reach,
			method: 'import',
		}
		const line = test_related_cap.deferred_line(selection, test_related_record.own_of(input))

		expect(line).toContain(`${String(record.deferred)} deferred to CI`)
		expect(line).toContain(`hub ${String(record.over_cap_hub)}`)
	})
})
