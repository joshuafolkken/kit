import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { test_pinned_emit } from './test-pinned-emit'
import type { Hunk } from './test-pinned-logic'

// joshuafolkken/kit#4647: a hunk whose revert emits the same JavaScript is not probed, so a comment or
// type edit never reads as unpinned, while a code edit still does.

const CONTENT = [
	'// The limit.',
	'interface Row {',
	'\tid: number',
	'}',
	'const LIMIT = 2',
	'export type { Row }',
	'export { LIMIT }',
	'',
].join('\n')
const OLD_COMMENT = '// The old limit.'
const OLD_LIMIT = 'const LIMIT = 3'

function hunk(new_start: number, old_lines: Array<string>, file = 'a.ts'): Hunk {
	return { file, new_start, new_count: 1, old_lines }
}

function changes(probe: Hunk): boolean {
	return test_pinned_emit.changes_runtime(ts, CONTENT, probe)
}

describe('test_pinned_emit.changes_runtime', () => {
	it('drops a hunk that only reverts a comment', () => {
		expect(changes(hunk(1, [OLD_COMMENT]))).toBe(false)
	})

	it('drops a hunk that only reverts a type member', () => {
		expect(changes(hunk(3, ['\tid: string']))).toBe(false)
	})

	it('keeps a hunk whose revert changes the emitted code', () => {
		expect(changes(hunk(5, [OLD_LIMIT]))).toBe(true)
	})

	it('keeps every hunk of a file that is not a script', () => {
		expect(changes(hunk(1, [OLD_COMMENT], 'a.svelte'))).toBe(true)
	})
})

describe('test_pinned_emit.probed_of', () => {
	it('keeps the code hunks, drops the comment one and counts the rewire', () => {
		const rewire_content = ["import { b } from './b'", 'b.run()', ''].join('\n')
		const code = hunk(5, [OLD_LIMIT])
		const hunks = [hunk(1, [OLD_COMMENT]), code, hunk(1, ["import { a } from './a'"], 'c.ts')]
		const contents = [CONTENT, CONTENT, rewire_content]

		expect(test_pinned_emit.probed_of(ts, hunks, contents)).toEqual({ hunks: [code], rewired: 1 })
	})
})
