import { describe, expect, it } from 'vitest'
import { lane_resolve_hunks } from './lane-resolve-hunks'

// joshuafolkken/kit#5837: step-back condition 2 is read off `git diff -U0` hunk headers alone.

const REWRITE_TEN_TO_TWELVE = '@@ -10,3 +10,3 @@ heading\n-a\n+b'
const REWRITE_TWELVE = '@@ -12 +12 @@\n-c\n+d'
const REWRITE_PAST_TWELVE = '@@ -13,2 +13,2 @@\n-e\n+f'
const INSERT_AFTER_ELEVEN = '@@ -11,0 +12,2 @@\n+g'
const REWRITE_IDENTICAL_FIVE = '@@ -5 +5 @@\n-x\n+y'
const REWRITE_THIRTEEN = '@@ -13 +13 @@\n-m\n+n'
const REWRITE_FOURTEEN = '@@ -14 +14 @@\n-o\n+p'

describe('lane_resolve_hunks.rewritten_ranges', () => {
	it('reads a counted and a single-line hunk as half-open base ranges', () => {
		expect(
			lane_resolve_hunks.rewritten_ranges(`${REWRITE_TEN_TO_TWELVE}\n${REWRITE_TWELVE}`),
		).toStrictEqual([
			{ start: 10, end: 13, change: '-a\n+b' },
			{ start: 12, end: 13, change: '-c\n+d' },
		])
	})

	it('drops a pure insertion, which rewrites no base line', () => {
		expect(lane_resolve_hunks.rewritten_ranges(INSERT_AFTER_ELEVEN)).toStrictEqual([])
	})
})

describe('lane_resolve_hunks.overlaps', () => {
	it('answers true when both sides rewrote one base line', () => {
		expect(lane_resolve_hunks.overlaps(REWRITE_TEN_TO_TWELVE, REWRITE_TWELVE)).toBe(true)
	})

	it('answers false for adjacent rewrites', () => {
		expect(lane_resolve_hunks.overlaps(REWRITE_TEN_TO_TWELVE, REWRITE_PAST_TWELVE)).toBe(false)
	})

	it('answers false when one side only inserted inside the other side’s range', () => {
		expect(lane_resolve_hunks.overlaps(REWRITE_TEN_TO_TWELVE, INSERT_AFTER_ELEVEN)).toBe(false)
	})

	it('answers false when both sides made one hunk identically beside adjacent rewrites', () => {
		const ours = `${REWRITE_IDENTICAL_FIVE}\n${REWRITE_THIRTEEN}`
		const theirs = `${REWRITE_IDENTICAL_FIVE}\n${REWRITE_FOURTEEN}`

		expect(lane_resolve_hunks.overlaps(ours, theirs)).toBe(false)
	})

	it('answers true when both sides rewrote one base range differently', () => {
		expect(lane_resolve_hunks.overlaps(REWRITE_IDENTICAL_FIVE, '@@ -5 +5 @@\n-x\n+z')).toBe(true)
	})

	it('answers false when a side changed nothing', () => {
		expect(lane_resolve_hunks.overlaps('', REWRITE_TWELVE)).toBe(false)
	})
})
