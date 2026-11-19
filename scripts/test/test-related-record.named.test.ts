import { describe, expect, it } from 'vitest'
import { test_related_record } from './test-related-record'

// joshuafolkken/kit#8090: the selection reads only what the run named — no main sync, no change since
// the map's tree — while a named file the branch did not change, a red run's failed test, stays.

const OWN_CHANGE = 'scripts/own.ts'
const SYNCED_CHANGE = 'scripts/synced.ts'
const SINCE_MAP_CHANGE = 'scripts/since-map.ts'
const FAILED_TEST = 'scripts/failed.test.ts'
const INPUT = {
	changed: [OWN_CHANGE, SYNCED_CHANGE, SINCE_MAP_CHANGE, FAILED_TEST],
	synced: [SYNCED_CHANGE],
	since_map: [SINCE_MAP_CHANGE],
	branch: [OWN_CHANGE],
}

describe('test_related_record.named_of', () => {
	it('leaves out the synced and since-map files, keeping a named file off the branch', () => {
		expect(test_related_record.named_of(INPUT)).toEqual([OWN_CHANGE, FAILED_TEST])
	})

	it('reads the own change from the branch where it was read, from the named files where not', () => {
		expect(test_related_record.own_of(INPUT)).toEqual([OWN_CHANGE])
		expect(test_related_record.own_of({ ...INPUT, branch: undefined })).toEqual([
			OWN_CHANGE,
			FAILED_TEST,
		])
	})
})
