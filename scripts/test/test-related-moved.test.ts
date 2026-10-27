import { describe, expect, it } from 'vitest'
import { test_related_moved } from './test-related-moved'
import type { SyncedSplit } from './test-related-synced'

const SOURCE = 'scripts/test/test-related.ts'
const OWN_TEST = 'scripts/test/test-related.synced-whole-suite.test.ts'
const MAIN_TEST = 'scripts/gate/gate-plan.test.ts'
const SYNCED_DATA = 'docs/josh-commands.md'
const LEFT_MODULE = 'scripts/gate/since-green.ts'
const NO_SPLIT: SyncedSplit = { shared: [], left: [], meeting: [] }
const LEFT_SPLIT: SyncedSplit = { shared: [], left: [LEFT_MODULE], meeting: [] }

describe('test_related_moved.is_whole_suite', () => {
	it('answers for a file every test depends on, and not for any other', () => {
		expect(test_related_moved.is_whole_suite('vitest.config.ts')).toBe(true)
		expect(test_related_moved.is_whole_suite(SOURCE)).toBe(false)
	})
})

describe('test_related_moved.narrowed_moved', () => {
	it('drops the synced modules the split left out', () => {
		expect(
			test_related_moved.narrowed_moved([SOURCE, LEFT_MODULE], LEFT_SPLIT, [SOURCE], undefined),
		).toEqual([SOURCE])
	})
})

describe('test_related_moved.moved_reading', () => {
	const parts = { changed: [SOURCE], synced: [SYNCED_DATA] }

	it("keeps the branch's own tests out of since_map and the synced data in it", () => {
		const change = { changed: [SOURCE], map: undefined, since_map: [OWN_TEST, MAIN_TEST] }
		const reading = test_related_moved.moved_reading(change, parts, [SOURCE, OWN_TEST], NO_SPLIT)

		expect(reading.since_map).toEqual([MAIN_TEST, SYNCED_DATA])
		expect(reading.synced).toEqual([SYNCED_DATA])
	})

	it('joins the modules the split left out to the change and to since_map', () => {
		const change = { changed: [SOURCE], map: undefined }
		const reading = test_related_moved.moved_reading(change, parts, [SOURCE], LEFT_SPLIT)

		expect(reading.changed).toEqual([SOURCE, LEFT_MODULE])
		expect(reading.since_map).toContain(LEFT_MODULE)
	})
})
