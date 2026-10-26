import { describe, expect, it } from 'vitest'
import { test_pinned_cache_logic, type GreenHunk } from './test-pinned-cache-logic'
import type { Hunk } from './test-pinned-logic'
import { test_pinned_prune_logic } from './test-pinned-prune-logic'

// joshuafolkken/kit#5004: a `red` verdict outlives lines removed from a `green` hunk, and nothing else.

const FILE = 'a.ts'
const COMMIT = 'commit-a'
const BASE = 'one\ntwo\n'
// `red` adds `pinned` after line 1; `green` adds `loose` and `spare` after line 2.
const BEFORE = 'one\npinned\ntwo\nloose\nspare\n'
const RED: Hunk = { file: FILE, new_start: 2, new_count: 1, old_lines: [], new_lines: ['pinned'] }
const GREEN: Hunk = {
	file: FILE,
	new_start: 4,
	new_count: 2,
	old_lines: [],
	new_lines: ['loose', 'spare'],
}
const RECORD: GreenHunk = { file: FILE, old_lines: [], new_lines: ['loose', 'spare'] }
const GREENS = [RECORD]
// `BEFORE` with every line of the green hunk removed.
const WITHOUT_GREEN = 'one\npinned\ntwo\n'
// The base with only the green hunk added.
const ONLY_GREEN = 'one\ntwo\nloose\nspare\n'
const GREEN_ALONE: Hunk = { ...GREEN, new_start: 3 }

// The `pruned` of a work tree whose only changed file holds `content`, with `reverts` reverted.
function pruned_with(
	content: string,
	reverts: ReadonlyArray<Hunk>,
	greens: ReadonlyArray<GreenHunk>,
): string {
	const is_changed = content !== BASE
	const code = {
		commit: COMMIT,
		code: is_changed ? [FILE] : [],
		digests: new Map(is_changed ? [[FILE, test_pinned_cache_logic.digest_of(content)]] : []),
	}

	return test_pinned_prune_logic.pruned_of(code, new Map([[FILE, content]]), reverts, greens)
}

// As a later run reads it: each of `hunks` that is a remnant of `greens` reverted.
function pruned(content: string, hunks: ReadonlyArray<Hunk>, greens = GREENS): string {
	return pruned_with(content, test_pinned_prune_logic.remnants_of(hunks, greens), greens)
}

// As the run that reached `verdicts` records it: exactly its `green` hunks reverted.
function recorded(content: string, hunks: ReadonlyArray<Hunk>, verdicts: Array<string>): string {
	const reached = test_pinned_prune_logic.greens_reached(hunks, verdicts)

	return pruned_with(
		content,
		reached,
		reached.map((hunk) => test_pinned_prune_logic.record_of(hunk)),
	)
}

const RECORDED = recorded(BEFORE, [RED, GREEN], ['red', 'green'])

describe('test_pinned_prune_logic.greens_reached', () => {
	it('takes only the line hunks whose verdict is green', () => {
		const stub = { ...GREEN, function_name: 'run' }
		const reached = test_pinned_prune_logic.greens_reached(
			[RED, GREEN, stub],
			['red', 'green', 'green'],
		)

		expect(reached).toEqual([GREEN])
		expect(reached.map((hunk) => test_pinned_prune_logic.record_of(hunk))).toEqual(GREENS)
	})
})

describe('test_pinned_prune_logic.is_remnant', () => {
	it('takes a green hunk whose lines were only removed, or none', () => {
		expect(test_pinned_prune_logic.is_remnant(GREEN, RECORD)).toBe(true)
		expect(test_pinned_prune_logic.is_remnant({ ...GREEN, new_lines: ['spare'] }, RECORD)).toBe(
			true,
		)
		expect(test_pinned_prune_logic.is_remnant({ ...GREEN, new_lines: [] }, RECORD)).toBe(true)
	})

	it('refuses a hunk with a line added or reordered, other base lines, another file or a stub', () => {
		for (const hunk of [
			{ ...GREEN, new_lines: ['loose', 'extra'] },
			{ ...GREEN, new_lines: ['spare', 'loose'] },
			{ ...GREEN, old_lines: ['two'] },
			{ ...GREEN, file: 'b.ts' },
			{ ...GREEN, function_name: 'run' },
		]) {
			expect(test_pinned_prune_logic.is_remnant(hunk, RECORD)).toBe(false)
		}
	})
})

describe('test_pinned_prune_logic.pruned_of', () => {
	it('reads the same once every line of the green hunk is removed', () => {
		expect(pruned(WITHOUT_GREEN, [RED])).toBe(RECORDED)
	})

	it('reads the same once one of its lines is removed, the rest left as a hunk of its own', () => {
		const rest: Hunk = { ...GREEN, new_count: 1, new_lines: ['spare'] }

		expect(pruned('one\npinned\ntwo\nspare\n', [RED, rest])).toBe(RECORDED)
	})

	it('reads the same when the removal leaves the file as its base', () => {
		const only_green = pruned(ONLY_GREEN, [GREEN_ALONE])

		expect(pruned(BASE, [])).toBe(only_green)
	})

	it('reads differently after any other edit, or with no green hunk recorded', () => {
		const added: Hunk = { ...GREEN, new_count: 1, new_lines: ['extra'] }

		expect(pruned('one\npinned\ntwo\nextra\n', [RED, added])).not.toBe(RECORDED)
		expect(pruned('one\npinned!\ntwo\n', [{ ...RED, new_lines: ['pinned!'] }])).not.toBe(RECORDED)
		expect(pruned(BEFORE, [RED, GREEN], [])).not.toBe(RECORDED)
	})

	it('reads differently once a red hunk that resembles a green one is removed', () => {
		// `red` adds `loose` after line 1, a subsequence of the green hunk on the same base lines.
		const lookalike: Hunk = { ...RED, new_lines: ['loose'] }
		const before = recorded('one\nloose\ntwo\nloose\nspare\n', [lookalike, GREEN], ['red', 'green'])

		expect(pruned(ONLY_GREEN, [GREEN_ALONE])).not.toBe(before)
	})
})
