import { describe, expect, it } from 'vitest'
import {
	test_pinned_cache_logic,
	type Freshness,
	type StoredVerdict,
} from './test-pinned-cache-logic'
import type { Hunk } from './test-pinned-logic'

const HUNK: Hunk = { file: 'a.ts', new_start: 2, new_count: 1, old_lines: ['old'] }
const CONTENT = 'one\nnew\nthree\n'
const COMMIT = 'commit-a'
const DIGESTS = new Map([
	['a.ts', 'digest-a'],
	['b.ts', 'digest-b'],
])
// joshuafolkken/kit#4790: the test file a `red` verdict failed in, and its content digest.
const FAILED_TEST = 'a.test.ts'
const FAILED_DIGEST = 'digest-t'
const TEST_DIGESTS = new Map([[FAILED_TEST, FAILED_DIGEST]])
const RED: StoredVerdict = { verdict: 'red', tests: { [FAILED_TEST]: FAILED_DIGEST } }
const RED_PROBE = { verdict: 'red', failed: [FAILED_TEST] }
const ONLY_TESTS_SAME: Freshness = { is_same_change: false, is_unchanged: true, is_pruned: false }
const ONLY_CODE_SAME: Freshness = { is_same_change: true, is_unchanged: false, is_pruned: false }
const ALL_SAME: Freshness = { is_same_change: true, is_unchanged: true, is_pruned: false }

function fresh(entry: StoredVerdict | undefined, freshness: Freshness): unknown {
	return test_pinned_cache_logic.fresh_verdict(entry, freshness, TEST_DIGESTS)
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
		test_contents: 'contents',
		change: 'change',
		entries: { key: RED },
	})

	it('reads the stored verdicts with the test files each failed in', () => {
		expect(test_pinned_cache_logic.entries_of(text)).toEqual({ key: RED })
	})

	it('holds nothing from an unreadable file or one in the format before failed tests were stored', () => {
		const bare = JSON.stringify({ test_contents: 'c', change: 'c', entries: { key: 'red' } })

		expect(test_pinned_cache_logic.entries_of(bare)).toEqual({})
		expect(test_pinned_cache_logic.entries_of('{')).toEqual({})
		expect(test_pinned_cache_logic.entries_of('')).toEqual({})
	})

	it('sets the change and test contents it was written under against the ones now', () => {
		const now = { change: 'change', test_contents: 'other' }

		expect(test_pinned_cache_logic.freshness_of(text, now)).toEqual({
			is_same_change: true,
			is_unchanged: false,
			is_pruned: false,
		})
		expect(test_pinned_cache_logic.freshness_of('', now)).toEqual({
			is_same_change: false,
			is_unchanged: false,
			is_pruned: false,
		})
	})
})

// joshuafolkken/kit#5004: the `green` hunks a cache recorded, and the code change with them reverted.
describe('test_pinned_cache_logic.greens_of and a pruned change', () => {
	const text = JSON.stringify({ test_contents: 'contents', change: 'change', entries: {} })
	const green = [{ file: 'a.ts', old_lines: [], new_lines: ['loose'] }]
	const recorded = JSON.stringify({ ...JSON.parse(text), pruned: 'p', green })
	const now = { change: 'other', test_contents: 'other', pruned: 'p' }

	it('reads the green hunks recorded, and none from a cache that recorded none', () => {
		expect(test_pinned_cache_logic.greens_of(recorded)).toEqual(green)
		expect(test_pinned_cache_logic.greens_of(text)).toEqual([])
	})

	it('reads the pruned change the same only where one was recorded and one is read now', () => {
		const unread = { ...now, pruned: undefined }

		expect(test_pinned_cache_logic.freshness_of(recorded, now).is_pruned).toBe(true)
		expect(test_pinned_cache_logic.freshness_of(text, now).is_pruned).toBe(false)
		expect(test_pinned_cache_logic.freshness_of(text, unread).is_pruned).toBe(false)
	})
})

describe('test_pinned_cache_logic.distinct', () => {
	it('numbers a key an identical hunk already took and leaves the first as it is', () => {
		expect(test_pinned_cache_logic.distinct(['k', 'j', 'k', 'k'])).toEqual(['k', 'j', 'k:1', 'k:2'])
	})
})

describe('test_pinned_cache_logic.fresh_verdict on a red verdict', () => {
	it('keeps a red verdict while the code change and the failed test file are the same, whatever other test changed', () => {
		expect(fresh(RED, ALL_SAME)).toEqual(RED_PROBE)
		expect(fresh(RED, ONLY_CODE_SAME)).toEqual(RED_PROBE)
	})

	it('drops a red verdict once the code change or the failed test file changed', () => {
		const edited = new Map([[FAILED_TEST, 'digest-u']])

		expect(fresh(RED, ONLY_TESTS_SAME)).toBeUndefined()
		expect(test_pinned_cache_logic.fresh_verdict(RED, ALL_SAME, edited)).toBeUndefined()
		expect(test_pinned_cache_logic.fresh_verdict(RED, ALL_SAME, new Map())).toBeUndefined()
	})

	it('keeps a red verdict with no failed file recorded only while no test file changed either', () => {
		const bare: StoredVerdict = { verdict: 'red', tests: {} }

		expect(fresh(bare, ALL_SAME)).toEqual({ verdict: 'red', failed: [] })
		expect(fresh(bare, ONLY_CODE_SAME)).toBeUndefined()
	})
})

// joshuafolkken/kit#5004: the code change since differs only by lines removed from `green` hunks.
describe('test_pinned_cache_logic.fresh_verdict past a pruned change', () => {
	const pruned: Freshness = { is_same_change: false, is_unchanged: false, is_pruned: true }

	it('keeps a red verdict while the failed test file is the same, and drops it once that changed', () => {
		const edited = new Map([[FAILED_TEST, 'digest-u']])

		expect(fresh(RED, pruned)).toEqual(RED_PROBE)
		expect(test_pinned_cache_logic.fresh_verdict(RED, pruned, edited)).toBeUndefined()
	})

	it('holds a green verdict on the test files alone, whatever the pruned change reads', () => {
		expect(fresh({ verdict: 'green', tests: {} }, pruned)).toBeUndefined()
	})
})

describe('test_pinned_cache_logic.fresh_verdict on any other verdict', () => {
	it('keeps a green or test-less verdict while no test file changed, whatever else changed', () => {
		const tests_changed: Freshness = {
			is_same_change: false,
			is_unchanged: false,
			is_pruned: false,
		}

		expect(fresh({ verdict: 'green', tests: {} }, ONLY_TESTS_SAME)).toEqual({
			verdict: 'green',
			failed: [],
		})
		expect(fresh({ verdict: 'no-test', tests: {} }, ONLY_TESTS_SAME)).toEqual({
			verdict: 'no-test',
			failed: [],
		})
		expect(fresh({ verdict: 'green', tests: {} }, tests_changed)).toBeUndefined()
	})

	it('holds nothing where nothing was stored', () => {
		expect(fresh(undefined, ALL_SAME)).toBeUndefined()
	})
})

describe('test_pinned_cache_logic.stored', () => {
	it('keys each verdict with its failed test files digested, and leaves out a key with none', () => {
		const probes = [{ verdict: 'red' as const, failed: [FAILED_TEST] }, undefined]

		expect(test_pinned_cache_logic.stored(['a', 'b'], probes, TEST_DIGESTS)).toEqual({ a: RED })
	})

	it('records no failed file when one of them has no digest, so the verdict rests on every test file', () => {
		const probes = [{ verdict: 'red' as const, failed: [FAILED_TEST, 'b.spec.ts'] }]

		expect(test_pinned_cache_logic.stored(['a'], probes, TEST_DIGESTS)).toEqual({
			a: { verdict: 'red', tests: {} },
		})
	})

	it('records each verdict with the basis read for it, and none where none was read', () => {
		const probes = [
			{ verdict: 'red' as const, failed: [FAILED_TEST] },
			{ verdict: 'green' as const, failed: [] },
		]

		expect(
			test_pinned_cache_logic.stored(['a', 'b'], probes, TEST_DIGESTS, [{ digest: 's' }]),
		).toEqual({
			a: { ...RED, basis: 's' },
			b: { verdict: 'green', tests: {} },
		})
	})

	it('records a green basis with the tests it rests on, so a later run can tell which changed', () => {
		const probes = [{ verdict: 'green' as const, failed: [] }]
		const bases = [{ digest: 'g', related: { [FAILED_TEST]: FAILED_DIGEST } }]

		expect(test_pinned_cache_logic.stored(['a'], probes, TEST_DIGESTS, bases)).toEqual({
			a: { verdict: 'green', tests: {}, basis: 'g', related: { [FAILED_TEST]: FAILED_DIGEST } },
		})
	})
})

// joshuafolkken/kit#4873: past the tree-wide digests, a verdict holds while its own basis is the same.
describe('test_pinned_cache_logic.fresh_verdict with a basis', () => {
	const none_same: Freshness = { is_same_change: false, is_unchanged: false, is_pruned: false }
	const green: StoredVerdict = { verdict: 'green', tests: {}, basis: 'b' }
	const red: StoredVerdict = { ...RED, basis: 'r' }

	it('keeps a green verdict past an edited test while the tests reaching its hunk are the same', () => {
		expect(test_pinned_cache_logic.fresh_verdict(green, none_same, TEST_DIGESTS, 'b')).toEqual({
			verdict: 'green',
			failed: [],
		})
		expect(
			test_pinned_cache_logic.fresh_verdict(green, none_same, TEST_DIGESTS, 'c'),
		).toBeUndefined()
	})

	it('keeps a red verdict past another code change while its basis and failed test are the same', () => {
		const edited = new Map([[FAILED_TEST, 'digest-u']])

		expect(test_pinned_cache_logic.fresh_verdict(red, none_same, TEST_DIGESTS, 'r')).toEqual(
			RED_PROBE,
		)
		expect(test_pinned_cache_logic.fresh_verdict(red, none_same, edited, 'r')).toBeUndefined()
		expect(test_pinned_cache_logic.fresh_verdict(red, none_same, TEST_DIGESTS, 's')).toBeUndefined()
	})

	it('falls back to the tree-wide digests where no basis was stored or none could be read now', () => {
		expect(test_pinned_cache_logic.fresh_verdict(RED, none_same, TEST_DIGESTS, 'r')).toBeUndefined()
		expect(test_pinned_cache_logic.fresh_verdict(red, none_same, TEST_DIGESTS)).toBeUndefined()
		expect(test_pinned_cache_logic.fresh_verdict(green, none_same, TEST_DIGESTS)).toBeUndefined()
	})
})

describe('test_pinned_cache_logic bases', () => {
	it('reads a related basis whatever order the tests are listed in, and moves with their content', () => {
		const digests = new Map([...TEST_DIGESTS, ['b.test.ts', 'digest-b']])
		const basis = test_pinned_cache_logic.related_basis([FAILED_TEST, 'b.test.ts'], digests)

		expect(test_pinned_cache_logic.related_basis(['b.test.ts', FAILED_TEST], digests)).toEqual(
			basis,
		)
		expect(test_pinned_cache_logic.related_basis([FAILED_TEST], digests).digest).not.toBe(
			basis.digest,
		)
		expect(basis.related).toEqual(Object.fromEntries(digests))
		expect(
			test_pinned_cache_logic.related_basis([FAILED_TEST], new Map([[FAILED_TEST, 'digest-x']]))
				.digest,
		).not.toBe(test_pinned_cache_logic.related_basis([FAILED_TEST], TEST_DIGESTS).digest)
	})

	it('reads a red basis whatever order the closures are in, and moves with the assets', () => {
		const basis = test_pinned_cache_logic.red_basis('x', [
			['a', '1'],
			['b', '2'],
		])

		expect(
			test_pinned_cache_logic.red_basis('x', [
				['b', '2'],
				['a', '1'],
			]),
		).toBe(basis)
		expect(
			test_pinned_cache_logic.red_basis('y', [
				['a', '1'],
				['b', '2'],
			]),
		).not.toBe(basis)
	})
})
