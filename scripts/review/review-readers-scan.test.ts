import { describe, expect, it } from 'vitest'
import { review_readers_scan } from './review-readers-scan'

const SOURCE = [
	"import { git_spawn } from '#scripts/git/git-spawn'",
	'',
	'const LIMIT = 3',
	'',
	'function helper(): number {',
	'	return LIMIT',
	'}',
	'',
	'async function read_merged(issue: string): Promise<boolean> {',
	'	return issue.length > helper()',
	'}',
	'',
	'export function direct(): string {',
	"	return 'x'",
	'}',
	'',
	'type Shape = { kind: string }',
	'',
	'const issue_merged = {',
	'	read_merged,',
	'	unchanged: helper,',
	'}',
	'',
	'export type { Shape }',
	'export { issue_merged }',
].join('\n')

function hunk(start: number, count?: number): string {
	const added = count === undefined ? String(start) : `${String(start)},${String(count)}`

	return `@@ -1,1 +${added} @@ context`
}

function targets(diff: string): Array<string> {
	return review_readers_scan.edited(SOURCE, diff).map((entry) => entry.target)
}

describe('review_readers_scan.changed_lines', () => {
	it('reads each hunk header as the new-side lines it covers', () => {
		expect(review_readers_scan.changed_lines([hunk(4, 2), '+text', hunk(9)].join('\n'))).toEqual([
			4, 5, 9,
		])
	})

	it('places a pure deletion on the line before it', () => {
		expect(review_readers_scan.changed_lines(hunk(10, 0))).toEqual([10])
	})

	it('reads no line from a diff with no hunk', () => {
		expect(review_readers_scan.changed_lines('diff --git a/x b/x\n+++ b/x')).toEqual([])
	})
})

describe('review_readers_scan.edited', () => {
	it('spells a namespace member the way a reader calls it, at its declaration line', () => {
		expect(review_readers_scan.edited(SOURCE, hunk(10))).toEqual([
			{ target: 'issue_merged.read_merged', line: 9 },
		])
	})

	it('names a direct export and an export-list type by themselves', () => {
		expect(targets([hunk(14), hunk(17)].join('\n'))).toEqual(['direct', 'Shape'])
	})

	it('misses a function exported only under another key, the alias the brief says it misses', () => {
		expect(targets(hunk(6))).toEqual([])
	})

	it('skips a name no other module can reach', () => {
		expect(targets(hunk(3))).toEqual([])
	})

	it('skips the namespace object itself when a member is added to it', () => {
		expect(targets(hunk(21))).toEqual([])
	})

	it('reads nothing from an untouched file', () => {
		expect(targets('')).toEqual([])
	})
})

const COMMENTED = [
	'export function first(): void {}',
	'',
	'// The second one.',
	'/**',
	' * More.',
	' */',
	'export function second(): void {}',
].join('\n')

function edited_at(line: number): Array<string> {
	return review_readers_scan.edited(COMMENTED, hunk(line)).map((entry) => entry.target)
}

describe('review_readers_scan.edited — where a declaration ends', () => {
	it('leaves a comment edited above a declaration out of the declaration before it', () => {
		expect([edited_at(1), edited_at(3), edited_at(5), edited_at(7)]).toEqual([
			['first'],
			[],
			[],
			['second'],
		])
	})
})
