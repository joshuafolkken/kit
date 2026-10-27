import { describe, expect, it } from 'vitest'
import {
	test_pinned_cache_logic,
	type Basis,
	type Freshness,
	type StoredVerdict,
} from './test-pinned-cache-logic'

// joshuafolkken/kit#4936: a `green` or `no-test` verdict is rechecked against only the tests added or
// edited since, while the code change is the same; joshuafolkken/kit#5129: a `red` one against the
// tests it failed in.
const OLD_TEST = 'a.test.ts'
const NEW_TEST = 'b.test.ts'
const SAME_CHANGE: Freshness = { is_same_change: true, is_unchanged: false, is_pruned: false }
const OTHER_CHANGE: Freshness = { is_same_change: false, is_unchanged: false, is_pruned: false }
const GREEN: StoredVerdict = {
	verdict: 'green',
	tests: {},
	basis: 'g',
	related: { [OLD_TEST]: 'digest-a' },
}

const DIGESTS: ReadonlyMap<string, string> = new Map([
	[OLD_TEST, 'digest-a'],
	[NEW_TEST, 'digest-b'],
])
// joshuafolkken/kit#5129: a pinned hunk that failed in `OLD_TEST`.
const RED: StoredVerdict = { verdict: 'red', tests: { [OLD_TEST]: 'digest-old' }, basis: 'r' }

function basis_with(related: Record<string, string>): Basis {
	return { digest: 'now', related }
}

describe('test_pinned_cache_logic.recheck_of', () => {
	it('rechecks a green verdict against a test added since, and one edited since', () => {
		const added = basis_with({ [OLD_TEST]: 'digest-a', [NEW_TEST]: 'digest-b' })
		const edited = basis_with({ [OLD_TEST]: 'digest-e' })

		expect(test_pinned_cache_logic.recheck_of(GREEN, SAME_CHANGE, added, DIGESTS)).toEqual({
			verdict: 'green',
			recheck: [NEW_TEST],
		})
		expect(test_pinned_cache_logic.recheck_of(GREEN, SAME_CHANGE, edited, DIGESTS)).toEqual({
			verdict: 'green',
			recheck: [OLD_TEST],
		})
	})

	it('rechecks nothing once a test is gone or the code change moved', () => {
		const added = basis_with({ [OLD_TEST]: 'digest-a', [NEW_TEST]: 'digest-b' })
		const removed = basis_with({ [NEW_TEST]: 'digest-b' })

		expect(test_pinned_cache_logic.recheck_of(GREEN, SAME_CHANGE, removed, DIGESTS)).toBeUndefined()
		expect(test_pinned_cache_logic.recheck_of(GREEN, OTHER_CHANGE, added, DIGESTS)).toBeUndefined()
	})

	it('rechecks nothing where no tests were recorded, or none changed', () => {
		const bare: StoredVerdict = { verdict: 'green', tests: {}, basis: 'g' }
		const same = basis_with({ [OLD_TEST]: 'digest-a' })

		expect(test_pinned_cache_logic.recheck_of(bare, SAME_CHANGE, same, DIGESTS)).toBeUndefined()
		expect(test_pinned_cache_logic.recheck_of(GREEN, SAME_CHANGE, same, DIGESTS)).toBeUndefined()
		expect(
			test_pinned_cache_logic.recheck_of(GREEN, SAME_CHANGE, undefined, DIGESTS),
		).toBeUndefined()
	})
})

describe('test_pinned_cache_logic.recheck_of on a red verdict', () => {
	it('rechecks a red verdict against the tests it failed in, whatever else moved', () => {
		expect(test_pinned_cache_logic.recheck_of(RED, OTHER_CHANGE, undefined, DIGESTS)).toEqual({
			verdict: 'red',
			recheck: [OLD_TEST],
		})
	})

	it('rechecks no red verdict whose failed test is gone, or that recorded no failed test', () => {
		const gone = new Map([[NEW_TEST, 'digest-b']])
		const bare: StoredVerdict = { verdict: 'red', tests: {} }

		expect(test_pinned_cache_logic.recheck_of(RED, OTHER_CHANGE, undefined, gone)).toBeUndefined()
		expect(
			test_pinned_cache_logic.recheck_of(bare, SAME_CHANGE, undefined, DIGESTS),
		).toBeUndefined()
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

	it('pins a red recheck whose test still fails, and answers nothing once it passes', () => {
		const red_recheck = { verdict: 'red' as const, recheck: [OLD_TEST] }
		const red = { verdict: 'red' as const, failed: [OLD_TEST] }
		const stopped = { verdict: 'stopped' as const, failed: [] }
		const green = { verdict: 'green' as const, failed: [] }
		const no_test = { verdict: 'no-test' as const, failed: [] }

		expect(test_pinned_cache_logic.rechecked(red_recheck, red)).toEqual(red)
		expect(test_pinned_cache_logic.rechecked(red_recheck, stopped)).toEqual(stopped)
		expect(test_pinned_cache_logic.rechecked(red_recheck, green)).toBeUndefined()
		expect(test_pinned_cache_logic.rechecked(red_recheck, no_test)).toBeUndefined()
	})
})
