import { describe, expect, it } from 'vitest'
import { diff_summary } from './diff-summary'

// joshuafolkken/kit#5547: the per-file table `josh diff:summary` prints, built from a fixed diff.

const BASE = 'abc1234'
const SAVED = '/repo/.git/josh-diff-summary.patch'
const DIFF = [
	'diff --git a/src/a.ts b/src/a.ts',
	'index 1111111..2222222 100644',
	'--- a/src/a.ts',
	'+++ b/src/a.ts',
	'@@ -3,2 +3,3 @@ function first(): void {',
	' \tconst kept = 1',
	'-\tconst old = 2',
	'+\tconst renamed = 2',
	'+\tconst more = 3',
	'@@ -20,0 +21,4 @@ const LIMIT = 5',
	'+',
	'+export function added(): number {',
	'+\treturn 1',
	'+}',
	'diff --git a/docs/b.md b/docs/b.md',
	'index 3333333..4444444 100644',
	'--- a/docs/b.md',
	'+++ b/docs/b.md',
	'@@ -7 +7 @@',
	'-old line',
	'+new line',
].join('\n')

describe('diff_summary.parse', () => {
	it('counts lines, hunks, new-side ranges and the touched declarations per file', () => {
		expect(diff_summary.parse(DIFF)).toStrictEqual([
			{
				file: 'src/a.ts',
				added: 6,
				deleted: 1,
				ranges: ['3-5', '21-24'],
				declarations: ['first', 'LIMIT', 'added'],
			},
			{ file: 'docs/b.md', added: 1, deleted: 1, ranges: ['7'], declarations: [] },
		])
	})

	it('reads a file header with no hunks, such as a binary change, as zero hunks', () => {
		const binary = 'diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ'

		expect(diff_summary.parse(binary)).toStrictEqual([
			{ file: 'i.png', added: 0, deleted: 0, ranges: [], declarations: [] },
		])
	})
})

describe('diff_summary.report', () => {
	it('prints one table row per file and the saved path last', () => {
		expect(diff_summary.report(DIFF, BASE, SAVED)).toBe(
			[
				'| file | + | - | hunks | ranges | declarations |',
				'| --- | --- | --- | --- | --- | --- |',
				'| `src/a.ts` | +6 | -1 | 2 | 3-5, 21-24 | first, LIMIT, added |',
				'| `docs/b.md` | +1 | -1 | 1 | 7 | — |',
				`full output: ${SAVED}`,
			].join('\n'),
		)
	})

	it('prints one explicit line, not an empty table, when there is no change', () => {
		expect(diff_summary.report('', BASE, SAVED)).toBe(`diff:summary: no changes against ${BASE}`)
	})
})
