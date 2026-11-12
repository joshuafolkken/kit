import { describe, expect, it } from 'vitest'
import { test_pinned_logic } from './test-pinned-logic'
import { test_pinned_moves } from './test-pinned-moves'

const FILE = 'driver.ts'
const HEADER = `--- a/${FILE}\n+++ b/${FILE}\n`
const DOWN = '@@ -2 +1,0 @@\n-role\n@@ -3,0 +3 @@\n+role'
const UP = '@@ -1,0 +2 @@\n+role\n@@ -3 +3,0 @@\n-role'
const CONTENT = 'head\nenv\nrole\ntail\n'
const BEFORE = 'head\nrole\nenv\ntail\n'

function grouped(diff: string): ReturnType<typeof test_pinned_moves.group> {
	const hunks = test_pinned_logic.parse_hunks(HEADER + diff)

	return test_pinned_moves.group(hunks)
}

describe('test_pinned_moves.group', () => {
	it.each([
		{ diff: DOWN, content: CONTENT, before: BEFORE },
		{ diff: UP, content: BEFORE, before: CONTENT },
	])('reverts both ends of a move: $diff', ({ diff, content, before }) => {
		const hunks = grouped(diff)

		expect(hunks).toHaveLength(1)
		for (const hunk of hunks) expect(test_pinned_logic.revert(content, hunk)).toBe(before)
	})

	it('keeps ordinary additions, deletions and replacements separate', () => {
		const diff = '@@ -1 +1 @@\n-old\n+new\n@@ -3 +2,0 @@\n-gone\n@@ -5,0 +5 @@\n+added'

		expect(grouped(diff)).toEqual(test_pinned_logic.parse_hunks(HEADER + diff))
	})

	it('does not pair identical text in different files', () => {
		const diff = `${HEADER}@@ -2 +1,0 @@\n-role\n--- a/other.ts\n+++ b/other.ts\n@@ -1,0 +2 @@\n+role`
		const hunks = test_pinned_logic.parse_hunks(diff)

		expect(test_pinned_moves.group(hunks)).toEqual(hunks)
	})
})

describe('test_pinned_moves.group with other changes', () => {
	it('keeps overlapping moves and an intervening replacement independent', () => {
		const diff =
			'@@ -2 +1,0 @@\n-A\n@@ -4 +2,0 @@\n-B\n@@ -5 +3 @@\n-old\n+new\n@@ -6,0 +5 @@\n+A\n@@ -7,0 +7 @@\n+B'
		const content = 'head\nx\nnew\ny\nA\nz\nB\nend\n'
		const hunks = grouped(diff)

		expect(hunks).toHaveLength(3)
		expect(hunks.map((hunk) => test_pinned_logic.revert(content, hunk))).toEqual([
			'head\nA\nx\nnew\ny\nz\nB\nend\n',
			'head\nx\nB\nnew\ny\nA\nz\nend\n',
			'head\nx\nold\ny\nA\nz\nB\nend\n',
		])
	})

	it('keeps identical multi-line blocks together without consuming a later change', () => {
		const diff = '@@ -2,2 +1,0 @@\n-A\n-B\n@@ -4,0 +3,2 @@\n+A\n+B\n@@ -6 +6 @@\n-old\n+new'
		const hunks = grouped(diff)

		expect(hunks).toHaveLength(2)
		expect(hunks[0]?.parts).toHaveLength(2)
		expect(hunks[1]?.old_lines).toEqual(['old'])
	})
})
