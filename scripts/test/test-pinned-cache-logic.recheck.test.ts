import { describe, expect, it } from 'vitest'
import {
	test_pinned_cache_logic,
	type Basis,
	type Freshness,
	type StoredVerdict,
} from './test-pinned-cache-logic'

// joshuafolkken/kit#4936: a `green` or `no-test` verdict is rechecked against only the tests added or
// edited since, while the code change is the same.
const OLD_TEST = 'a.test.ts'
const NEW_TEST = 'b.test.ts'
const SAME_CHANGE: Freshness = { is_same_change: true, is_unchanged: false }
const OTHER_CHANGE: Freshness = { is_same_change: false, is_unchanged: false }
const GREEN: StoredVerdict = {
	verdict: 'green',
	tests: {},
	basis: 'g',
	related: { [OLD_TEST]: 'digest-a' },
}

function basis_with(related: Record<string, string>): Basis {
	return { digest: 'now', related }
}

describe('test_pinned_cache_logic.recheck_of', () => {
	it('rechecks a green verdict against a test added since, and one edited since', () => {
		const added = basis_with({ [OLD_TEST]: 'digest-a', [NEW_TEST]: 'digest-b' })
		const edited = basis_with({ [OLD_TEST]: 'digest-e' })

		expect(test_pinned_cache_logic.recheck_of(GREEN, SAME_CHANGE, added)).toEqual({
			verdict: 'green',
			recheck: [NEW_TEST],
		})
		expect(test_pinned_cache_logic.recheck_of(GREEN, SAME_CHANGE, edited)).toEqual({
			verdict: 'green',
			recheck: [OLD_TEST],
		})
	})

	it('rechecks nothing once a test is gone, the code change moved or the verdict is red', () => {
		const added = basis_with({ [OLD_TEST]: 'digest-a', [NEW_TEST]: 'digest-b' })
		const removed = basis_with({ [NEW_TEST]: 'digest-b' })
		const red: StoredVerdict = { ...GREEN, verdict: 'red' }

		expect(test_pinned_cache_logic.recheck_of(GREEN, SAME_CHANGE, removed)).toBeUndefined()
		expect(test_pinned_cache_logic.recheck_of(GREEN, OTHER_CHANGE, added)).toBeUndefined()
		expect(test_pinned_cache_logic.recheck_of(red, SAME_CHANGE, added)).toBeUndefined()
	})

	it('rechecks nothing where no tests were recorded, or none changed', () => {
		const bare: StoredVerdict = { verdict: 'green', tests: {}, basis: 'g' }
		const same = basis_with({ [OLD_TEST]: 'digest-a' })

		expect(test_pinned_cache_logic.recheck_of(bare, SAME_CHANGE, same)).toBeUndefined()
		expect(test_pinned_cache_logic.recheck_of(GREEN, SAME_CHANGE, same)).toBeUndefined()
		expect(test_pinned_cache_logic.recheck_of(GREEN, SAME_CHANGE, undefined)).toBeUndefined()
	})
})

describe('test_pinned_cache_logic.rechecked', () => {
	const recheck = { verdict: 'no-test' as const, recheck: [NEW_TEST] }

	it('pins the hunk on a red recheck, and keeps the stored verdict on a recheck with no test', () => {
		const red = { verdict: 'red' as const, failed: [NEW_TEST] }

		expect(test_pinned_cache_logic.rechecked(recheck, red)).toEqual(red)
		expect(test_pinned_cache_logic.rechecked(recheck, { verdict: 'no-test', failed: [] })).toEqual({
			verdict: 'no-test',
			failed: [],
		})
	})

	it('reads a green recheck as green, and tells a recheck from a verdict', () => {
		const green = { verdict: 'green' as const, failed: [] }

		expect(test_pinned_cache_logic.rechecked(recheck, green)).toEqual(green)
		expect(test_pinned_cache_logic.is_recheck(recheck)).toBe(true)
		expect(test_pinned_cache_logic.is_recheck(green)).toBe(false)
		expect(test_pinned_cache_logic.is_recheck(undefined)).toBe(false)
	})
})
