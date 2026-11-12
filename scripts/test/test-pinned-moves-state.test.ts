import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { test_pinned_cache_logic } from './test-pinned-cache-logic'
import { test_pinned_emit } from './test-pinned-emit'
import type { Hunk, PinnedReport } from './test-pinned-logic'
import { test_pinned_prune_logic } from './test-pinned-prune-logic'
import { test_pinned_record } from './test-pinned-record'
import { test_pinned_rewire } from './test-pinned-rewire'

const CONTENT = 'head\nenv\nrole\ntail\n'
const DELETION: Hunk = {
	file: 'driver.ts',
	new_start: 1,
	new_count: 0,
	old_lines: ['role'],
	new_lines: [],
}
const INSERTION: Hunk = {
	file: 'driver.ts',
	new_start: 3,
	new_count: 1,
	old_lines: [],
	new_lines: ['role'],
}
const MOVE: Hunk = { ...DELETION, parts: [DELETION, INSERTION] }
const OTHER: Hunk = { ...MOVE, parts: [DELETION, { ...INSERTION, new_lines: ['other'] }] }

function sites(hunk: Hunk): ReadonlyArray<string> {
	const report: PinnedReport = {
		unpinned: [{ ...hunk, is_green: true }],
		stopped: [],
		unchecked: [],
		unparsed: [],
		max_hunks: 1,
		has_runner: true,
	}

	return test_pinned_record.summary_of(report).unpinned
}

describe('moved hunk identity', () => {
	it('cannot reuse the cached verdict of a partial revert', () => {
		const key = test_pinned_cache_logic.hunk_key(MOVE, CONTENT)

		expect(key).not.toBe(test_pinned_cache_logic.hunk_key(DELETION, CONTENT))
		expect(key).not.toBe(test_pinned_cache_logic.hunk_key(INSERTION, CONTENT))
		expect(key).not.toBe(test_pinned_cache_logic.hunk_key(MOVE, CONTENT.replace('role', 'other')))
	})

	it('records both ends so a partial-revert approval cannot accept a move', () => {
		expect(sites(MOVE)).not.toEqual(sites(DELETION))
		expect(sites(MOVE)).not.toEqual(sites(INSERTION))
		expect(sites(MOVE)).not.toEqual(sites(OTHER))
	})
})

describe('moved hunk optimization boundaries', () => {
	it('does not infer that either end alone is green for pruning', () => {
		expect(test_pinned_prune_logic.greens_reached([MOVE, INSERTION], ['green', 'green'])).toEqual([
			INSERTION,
		])
		expect(
			test_pinned_prune_logic.remnants_of([MOVE], [test_pinned_prune_logic.record_of(DELETION)]),
		).toEqual([])
	})

	it('does not drop a move using a rewire classification of only its first part', () => {
		const rewire = vi.spyOn(test_pinned_rewire, 'is_rewire').mockReturnValue(true)

		try {
			expect(test_pinned_emit.probed_of(ts, [MOVE], [CONTENT]).hunks).toEqual([MOVE])
		} finally {
			rewire.mockRestore()
		}
	})
})
