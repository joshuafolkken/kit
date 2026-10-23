import { describe, expect, it } from 'vitest'
import { test_pinned_cache_logic, type Freshness } from './test-pinned-cache-logic'
import type { Hunk } from './test-pinned-logic'

const HUNK: Hunk = { file: 'a.ts', new_start: 2, new_count: 1, old_lines: ['old'] }
const CONTENT = 'one\nnew\nthree\n'
const COMMIT = 'commit-a'
const DIGESTS = new Map([
	['a.ts', 'digest-a'],
	['b.ts', 'digest-b'],
])

describe('test_pinned_cache_logic.hunk_key', () => {
	it('keeps the key of a hunk that only moved', () => {
		const moved = { ...HUNK, new_start: 3 }

		expect(test_pinned_cache_logic.hunk_key(moved, `zero\n${CONTENT}`)).toBe(
			test_pinned_cache_logic.hunk_key(HUNK, CONTENT),
		)
	})

	it('changes the key when the hunk lines, its old lines or its function change', () => {
		const key = test_pinned_cache_logic.hunk_key(HUNK, CONTENT)

		expect(test_pinned_cache_logic.hunk_key(HUNK, 'one\nnewer\nthree\n')).not.toBe(key)
		expect(test_pinned_cache_logic.hunk_key({ ...HUNK, old_lines: ['older'] }, CONTENT)).not.toBe(
			key,
		)
		expect(test_pinned_cache_logic.hunk_key({ ...HUNK, function_name: 'run' }, CONTENT)).not.toBe(
			key,
		)
	})
})

describe('test_pinned_cache_logic.test_set_of', () => {
	it('reads the same set whatever order it was listed in, and another set differently', () => {
		const set = test_pinned_cache_logic.test_set_of(['b.test.ts', 'a.test.ts'])

		expect(test_pinned_cache_logic.test_set_of(['a.test.ts', 'b.test.ts'])).toBe(set)
		expect(test_pinned_cache_logic.test_set_of(['a.test.ts'])).not.toBe(set)
	})
})

describe('test_pinned_cache_logic.change_of', () => {
	const change = test_pinned_cache_logic.change_of(COMMIT, ['a.ts', 'b.ts'], DIGESTS)

	it('reads the same change whatever order its paths were listed in', () => {
		expect(test_pinned_cache_logic.change_of(COMMIT, ['b.ts', 'a.ts'], DIGESTS)).toBe(change)
	})

	it('reads another change on another base, path, content or a deletion', () => {
		const edited = new Map([...DIGESTS, ['b.ts', 'digest-c']])
		const deleted = new Map([['a.ts', 'digest-a']])

		expect(test_pinned_cache_logic.change_of('commit-b', ['a.ts', 'b.ts'], DIGESTS)).not.toBe(
			change,
		)
		expect(test_pinned_cache_logic.change_of(COMMIT, ['a.ts'], DIGESTS)).not.toBe(change)
		expect(test_pinned_cache_logic.change_of(COMMIT, ['a.ts', 'b.ts'], edited)).not.toBe(change)
		expect(test_pinned_cache_logic.change_of(COMMIT, ['a.ts', 'b.ts'], deleted)).not.toBe(change)
	})
})

describe('test_pinned_cache_logic.entries_of', () => {
	const text = JSON.stringify({
		test_set: 'set',
		test_contents: 'contents',
		change: 'change',
		entries: { key: 'red' },
	})

	it('reads the verdicts written under the same test set', () => {
		expect(test_pinned_cache_logic.entries_of(text, 'set')).toEqual({ key: 'red' })
	})

	it('holds nothing under another test set or from an unreadable file', () => {
		expect(test_pinned_cache_logic.entries_of(text, 'other')).toEqual({})
		expect(test_pinned_cache_logic.entries_of('{', 'set')).toEqual({})
		expect(test_pinned_cache_logic.entries_of('', 'set')).toEqual({})
	})

	it('sets the change and test contents it was written under against the ones now', () => {
		const now = { change: 'change', test_contents: 'other' }

		expect(test_pinned_cache_logic.freshness_of(text, now)).toEqual({
			is_same_change: true,
			is_unchanged: false,
		})
		expect(test_pinned_cache_logic.freshness_of('', now)).toEqual({
			is_same_change: false,
			is_unchanged: false,
		})
	})
})

describe('test_pinned_cache_logic.distinct', () => {
	it('numbers a key an identical hunk already took and leaves the first as it is', () => {
		expect(test_pinned_cache_logic.distinct(['k', 'j', 'k', 'k'])).toEqual(['k', 'j', 'k:1', 'k:2'])
	})
})

describe('test_pinned_cache_logic.fresh_verdict', () => {
	const ONLY_TESTS_SAME: Freshness = { is_same_change: false, is_unchanged: true }
	const ALL_SAME: Freshness = { is_same_change: true, is_unchanged: true }

	it('keeps a red verdict only while the whole change is the same, even with no test changed', () => {
		expect(test_pinned_cache_logic.fresh_verdict('red', ALL_SAME)).toBe('red')
		expect(test_pinned_cache_logic.fresh_verdict('red', ONLY_TESTS_SAME)).toBeUndefined()
	})

	it('keeps a green or test-less verdict while no test file changed, whatever else changed', () => {
		const tests_changed: Freshness = { is_same_change: false, is_unchanged: false }

		expect(test_pinned_cache_logic.fresh_verdict('green', ONLY_TESTS_SAME)).toBe('green')
		expect(test_pinned_cache_logic.fresh_verdict('no-test', ONLY_TESTS_SAME)).toBe('no-test')
		expect(test_pinned_cache_logic.fresh_verdict('green', tests_changed)).toBeUndefined()
	})

	it('holds nothing where nothing was stored', () => {
		expect(test_pinned_cache_logic.fresh_verdict(undefined, ALL_SAME)).toBeUndefined()
	})
})

describe('test_pinned_cache_logic.stored', () => {
	it('keys each verdict and leaves out a key with none', () => {
		expect(test_pinned_cache_logic.stored(['a', 'b'], ['red', undefined])).toEqual({ a: 'red' })
	})
})
