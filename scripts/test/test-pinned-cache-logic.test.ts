import { describe, expect, it } from 'vitest'
import { test_pinned_cache_logic, type CachedVerdict } from './test-pinned-cache-logic'
import type { Hunk } from './test-pinned-logic'

const HUNK: Hunk = { file: 'a.ts', new_start: 2, new_count: 1, old_lines: ['old'] }
const CONTENT = 'one\nnew\nthree\n'
const ENTRY: CachedVerdict = {
	verdict: 'red',
	tests: Object.fromEntries([['a.test.ts', 'digest-a']]),
}

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

describe('test_pinned_cache_logic.tree_relative', () => {
	it('reads each name under the first root that holds it and drops one under none', () => {
		const names = ['/var/t/a.test.ts', '/private/var/t/b.test.ts', '/elsewhere/c.test.ts']

		expect(test_pinned_cache_logic.tree_relative(names, ['/var/t', '/private/var/t'])).toEqual([
			'a.test.ts',
			'b.test.ts',
		])
	})
})

describe('test_pinned_cache_logic.entries_of', () => {
	const text = JSON.stringify({
		test_set: 'set',
		test_contents: 'contents',
		entries: { key: ENTRY },
	})

	it('reads the entries written under the same test set', () => {
		expect(test_pinned_cache_logic.entries_of(text, 'set')).toEqual({ key: ENTRY })
	})

	it('holds nothing under another test set or from an unreadable file', () => {
		expect(test_pinned_cache_logic.entries_of(text, 'other')).toEqual({})
		expect(test_pinned_cache_logic.entries_of('{', 'set')).toEqual({})
		expect(test_pinned_cache_logic.entries_of('', 'set')).toEqual({})
	})

	it('reads the test contents the cache was written under, and none from an unreadable file', () => {
		expect(test_pinned_cache_logic.contents_of(text)).toBe('contents')
		expect(test_pinned_cache_logic.contents_of('')).toBe('')
	})
})

describe('test_pinned_cache_logic.distinct', () => {
	it('numbers a key an identical hunk already took and leaves the first as it is', () => {
		expect(test_pinned_cache_logic.distinct(['k', 'j', 'k', 'k'])).toEqual(['k', 'j', 'k:1', 'k:2'])
	})
})

describe('test_pinned_cache_logic.fresh_entry', () => {
	const GREEN: CachedVerdict = { ...ENTRY, verdict: 'green' }

	it('keeps a red entry while every test it ran has its recorded digest, whatever else changed', () => {
		const digests = new Map([['a.test.ts', 'digest-a']])

		expect(test_pinned_cache_logic.fresh_entry(ENTRY, digests, false)).toBe(ENTRY)
	})

	it('drops a red entry once a test it ran changed or is gone, or when there is none', () => {
		expect(
			test_pinned_cache_logic.fresh_entry(ENTRY, new Map([['a.test.ts', 'digest-b']]), true),
		).toBeUndefined()
		expect(test_pinned_cache_logic.fresh_entry(ENTRY, new Map(), true)).toBeUndefined()
		expect(test_pinned_cache_logic.fresh_entry(undefined, new Map(), true)).toBeUndefined()
	})

	it('keeps a green or test-less entry only while no test file changed', () => {
		const digests = new Map([['a.test.ts', 'digest-a']])
		const no_tests: CachedVerdict = { verdict: 'red', tests: {} }

		expect(test_pinned_cache_logic.fresh_entry(GREEN, digests, true)).toBe(GREEN)
		expect(test_pinned_cache_logic.fresh_entry(GREEN, digests, false)).toBeUndefined()
		expect(test_pinned_cache_logic.fresh_entry(no_tests, digests, false)).toBeUndefined()
	})
})

describe('test_pinned_cache_logic.stored', () => {
	it('keys each entry and leaves out a key with none', () => {
		expect(test_pinned_cache_logic.stored(['a', 'b'], [ENTRY, undefined])).toEqual({ a: ENTRY })
	})
})
