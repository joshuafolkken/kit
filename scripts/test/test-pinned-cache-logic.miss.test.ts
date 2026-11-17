import { describe, expect, it } from 'vitest'
import {
	test_pinned_cache_logic,
	type Freshness,
	type StoredVerdict,
} from './test-pinned-cache-logic'

// joshuafolkken/kit#7804: why the cache did not hold a hunk's verdict, read off the same keys
// `fresh_verdict` holds it by.
const FAILED_TEST = 'a.test.ts'
const FAILED_DIGEST = 'digest-t'
const DIGESTS = new Map([[FAILED_TEST, FAILED_DIGEST]])
const EDITED_DIGESTS = new Map([[FAILED_TEST, 'digest-edited']])
const RED: StoredVerdict = { verdict: 'red', tests: { [FAILED_TEST]: FAILED_DIGEST } }
const GREEN: StoredVerdict = { verdict: 'green', tests: {} }
const ALL_SAME: Freshness = { is_same_change: true, is_unchanged: true, is_pruned: false }
const OTHER_CHANGE: Freshness = { is_same_change: false, is_unchanged: true, is_pruned: false }
const OTHER_TESTS: Freshness = { is_same_change: true, is_unchanged: false, is_pruned: false }
const NOTHING_SAME: Freshness = { is_same_change: false, is_unchanged: false, is_pruned: false }

function miss(
	entry: StoredVerdict | undefined,
	freshness: Freshness,
	digests: ReadonlyMap<string, string> = DIGESTS,
	basis?: string,
): unknown {
	return test_pinned_cache_logic.miss_of(entry, freshness, digests, basis)
}

describe('test_pinned_cache_logic.miss_of', () => {
	it('answers unregistered where no verdict is stored', () => {
		expect(miss(undefined, ALL_SAME)).toBe('unregistered')
	})

	it('answers nothing for a red and a green verdict that still hold', () => {
		expect(miss(RED, ALL_SAME)).toBeUndefined()
		expect(miss(GREEN, ALL_SAME)).toBeUndefined()
	})

	it('answers change for a red verdict whose code change differs', () => {
		expect(miss(RED, OTHER_CHANGE)).toBe('change')
	})

	it('answers test_contents for a red verdict whose failed test was edited', () => {
		expect(miss(RED, ALL_SAME, EDITED_DIGESTS)).toBe('test_contents')
	})

	it('answers test_contents for a green verdict once a test file changed', () => {
		expect(miss(GREEN, OTHER_TESTS)).toBe('test_contents')
	})

	it('answers basis for a red and a green verdict whose stored basis no longer reads the same', () => {
		expect(miss({ ...RED, basis: 'then' }, NOTHING_SAME, DIGESTS, 'now')).toBe('basis')
		expect(miss({ ...GREEN, basis: 'then' }, NOTHING_SAME, DIGESTS, 'now')).toBe('basis')
	})

	it('answers nothing for a red and a green verdict their basis still holds', () => {
		expect(miss({ ...RED, basis: 'same' }, NOTHING_SAME, DIGESTS, 'same')).toBeUndefined()
		expect(miss({ ...GREEN, basis: 'same' }, NOTHING_SAME, DIGESTS, 'same')).toBeUndefined()
	})
})
