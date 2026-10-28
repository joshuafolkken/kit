import type { Hit } from '#scripts/git/git-grep-hits'
import type { Hunk } from '#scripts/test/test-pinned-logic'
import { describe, expect, it } from 'vitest'
import { prose_stale_scan, type Reference, type Term } from './prose-stale-scan'

const CODE = 'scripts/a.ts'
const DOC = 'docs/a.md'
const NONE: ReadonlySet<string> = new Set()
const OLD_COMMAND = 'old:command'
const OLD_LIMIT_LINE = 'const OLD_LIMIT = 3'
const EXPORT_NAME: Term = { kind: 'export', word: 'old_name' }
const CONSTANT: Term = { kind: 'constant', word: 'OLD_LIMIT' }
const COMMAND: Term = { kind: 'command', word: OLD_COMMAND }
const HEADING: Term = { kind: 'heading', word: 'Old heading' }

function hunk(file: string, old_lines: Array<string>, new_lines: Array<string> = []): Hunk {
	return { file, new_start: 1, new_count: new_lines.length, old_lines, new_lines }
}

function terms(hunks: Array<Hunk>, registered = NONE): Array<Term> {
	return prose_stale_scan.stale_terms(hunks, registered)
}

function hit(path: string, excerpt: string): Hit {
	return { path, line: '3', excerpt }
}

describe('prose_stale_scan.stale_terms — each kind a removed line names', () => {
	it.each([
		{
			name: 'a direct export',
			file: CODE,
			line: 'export function old_name(): void {',
			term: EXPORT_NAME,
		},
		{ name: 'an export list entry', file: CODE, line: 'export { old_name }', term: EXPORT_NAME },
		{ name: 'an UPPER_CASE constant', file: CODE, line: OLD_LIMIT_LINE, term: CONSTANT },
		{
			name: 'a josh command in prose',
			file: DOC,
			line: 'Run `pnpm josh old:command`.',
			term: COMMAND,
		},
		{ name: 'a josh command in a comment', file: CODE, line: '// josh old:command', term: COMMAND },
		{ name: 'a .md heading', file: DOC, line: '## Old heading ', term: HEADING },
	])('takes $name', ({ file, line, term }) => {
		expect(terms([hunk(file, [line])])).toEqual([term])
	})

	it.each([
		['a heading line outside a .md file', CODE, '# Not a heading'],
		['a non-exported lower-case declaration', CODE, 'function helper(): void {'],
		['an indented constant', CODE, '\tconst INNER_LIMIT = 3'],
		['a declaration in a .md file', DOC, 'export function in_prose(): void {'],
		['a josh command with no colon', DOC, 'Run `pnpm josh gate`.'],
	])('takes nothing from %s', (_name, file, line) => {
		expect(terms([hunk(file, [line])])).toEqual([])
	})

	it('names a word once however many removed lines carry it', () => {
		const removed = [hunk(DOC, [`josh ${OLD_COMMAND}`]), hunk(CODE, [`// josh ${OLD_COMMAND}`])]

		expect(terms(removed)).toEqual([COMMAND])
	})
})

describe('prose_stale_scan.stale_terms — a word the diff still writes is kept', () => {
	it('drops an identifier an added line in any file carries', () => {
		const moved = [
			hunk(CODE, ['export { old_space }']),
			hunk('scripts/b.ts', [], ['export { old_space, extra }']),
		]

		expect(terms(moved)).toEqual([])
	})

	it('drops a command an added line carries, and one the registry still holds', () => {
		const reworded = hunk(
			DOC,
			['josh kept:command and josh live:command'],
			['see josh kept:command'],
		)

		expect(terms([reworded], new Set(['live:command']))).toEqual([])
	})

	it('drops a heading an added .md line still titles, but not one only its words survive in', () => {
		const demoted = hunk(
			DOC,
			['## Same title', '## Gone title'],
			['### Same title', 'Gone title is prose'],
		)

		expect(terms([demoted])).toEqual([{ kind: 'heading', word: 'Gone title' }])
	})

	it('keeps a word an added line carries only inside a longer token', () => {
		const prefixed = hunk(CODE, [OLD_LIMIT_LINE], ['const OLD_LIMIT_MS = 3'])

		expect(terms([prefixed])).toEqual([CONSTANT])
	})
})

describe('prose_stale_scan.pattern', () => {
	it('searches a heading quoted, as a pointer names it, and any other word whole', () => {
		expect(prose_stale_scan.pattern({ kind: 'heading', word: 'A b' })).toEqual({
			target: '"A b"',
			flags: [],
		})
		expect(prose_stale_scan.pattern({ kind: 'export', word: 'a_b' })).toEqual({
			target: 'a_b',
			flags: ['-w'],
		})
	})
})

describe('prose_stale_scan.report', () => {
	const term: Term = { kind: 'export', word: 'old_name' }

	function reference(hits: Array<Hit>, has_failed = false): Reference {
		return { term, hits, has_failed }
	}

	it('answers ok with exit 0 when no search found prose', () => {
		expect(prose_stale_scan.report([reference([])])).toEqual({ text: 'ok', exit_code: 0 })
		expect(prose_stale_scan.report([])).toEqual({ text: 'ok', exit_code: 0 })
	})

	it('lists a .md line and a comment line as file:line kind word, and drops a code line', () => {
		const hits = [
			hit('docs/x.md', 'call old_name here'),
			hit('scripts/x.ts', '\t// old_name reads it'),
			hit('scripts/y.ts', ' * old_name in a block comment'),
			hit('.claude/hooks/x.sh', '# old_name'),
			hit('scripts/z.ts', 'old_name()'),
		]

		expect(prose_stale_scan.report([reference(hits)])).toEqual({
			text: [
				'docs/x.md:3 export old_name',
				'scripts/x.ts:3 export old_name',
				'scripts/y.ts:3 export old_name',
				'.claude/hooks/x.sh:3 export old_name',
			].join('\n'),
			exit_code: 1,
		})
	})

	it('never reads a failed search as none: it is named and exits 2', () => {
		expect(prose_stale_scan.report([reference([], true)])).toEqual({
			text: 'search failed: export old_name',
			exit_code: prose_stale_scan.FAILED_EXIT,
		})
	})
})
