import type { Hit } from '#scripts/git/git-grep-hits'
import type { Hunk } from '#scripts/test/test-pinned-logic'
import { describe, expect, it } from 'vitest'
import { prose_stale_scan, type Reference, type Term } from './prose-stale-scan'

const CODE = 'scripts/a.ts'
const DOC = 'docs/a.md'
const NONE: ReadonlySet<string> = new Set()
const OLD_COMMAND = 'old:command'
const OLD_LIMIT_LINE = 'const OLD_LIMIT = 3'
const OTHER_CODE = 'scripts/b.ts'
const OLD_FUNCTION_LINE = 'function old_name(): void {'
const NEW_FUNCTION_LINE = 'function new_name(): void {'
const NAME: Term = { kind: 'name', word: 'old_name' }
const CONSTANT: Term = { kind: 'constant', word: 'OLD_LIMIT' }
const COMMAND: Term = { kind: 'command', word: OLD_COMMAND }
const HEADING: Term = { kind: 'heading', word: 'Old heading' }

function hunk(file: string, old_lines: Array<string>, new_lines: Array<string> = []): Hunk {
	return { file, new_start: 1, new_count: new_lines.length, old_lines, new_lines }
}

function terms(hunks: Array<Hunk>, registered = NONE, surviving = NONE): Array<Term> {
	return prose_stale_scan.stale_terms(hunks, registered, { surviving, deleted: NONE })
}

function hit(path: string, excerpt: string): Hit {
	return { path, line: '3', excerpt }
}

const TAKEN = [
	{ name: 'a direct export', file: CODE, line: 'export function old_name(): void {', term: NAME },
	{ name: 'an export list entry', file: CODE, line: 'export { old_name }', term: NAME },
	// A namespace object's member: its removed lines are a plain `function` and a `\told_name,` entry.
	{ name: 'a top-level declaration', file: CODE, line: OLD_FUNCTION_LINE, term: NAME },
	{ name: 'an UPPER_CASE constant', file: CODE, line: OLD_LIMIT_LINE, term: CONSTANT },
	{
		name: 'a josh command in prose',
		file: DOC,
		line: 'Run `pnpm josh old:command`.',
		term: COMMAND,
	},
	{ name: 'a josh command in a comment', file: CODE, line: '// josh old:command', term: COMMAND },
	{ name: 'a .md heading', file: DOC, line: '## Old heading ', term: HEADING },
]

describe('prose_stale_scan.stale_terms — each kind a removed line names', () => {
	it.each(TAKEN)('takes $name', ({ file, line, term }) => {
		expect(terms([hunk(file, [line])])).toEqual([term])
	})

	it.each([
		['a heading line outside a .md file', CODE, '# Not a heading'],
		['a namespace object entry', CODE, '\told_name,'],
		['an indented constant', CODE, '\tconst INNER_LIMIT = 3'],
		['a declaration in a .md file', DOC, 'export function in_prose(): void {'],
		['a josh command with no colon', DOC, 'Run `pnpm josh gate`.'],
	])('takes nothing from %s', (_name, file, line) => {
		expect(terms([hunk(file, [line])])).toEqual([])
	})

	// joshuafolkken/kit#6737: `gh-usage-event.test.ts`'s own `Appended` and `text_of`.
	it('takes no name from a test file, and keeps one another file removed too', () => {
		const test_file = 'scripts/gh/x.test.ts'
		const local = ['type Appended = string', 'function text_of(): string {', OLD_FUNCTION_LINE]

		expect(terms([hunk(test_file, local)])).toEqual([])
		expect(terms([hunk(test_file, local), hunk(CODE, [OLD_FUNCTION_LINE])])).toEqual([NAME])
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
			hunk(OTHER_CODE, [], ['export { old_space, extra }']),
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

		expect(terms([prefixed])).toEqual([{ ...CONSTANT, renamed_to: 'OLD_LIMIT_MS' }])
	})
})

describe('prose_stale_scan.stale_terms — a name the working tree still declares', () => {
	it('drops a name a changed file still declares on an unchanged line, renamed or not', () => {
		const removed = [
			hunk(CODE, [OLD_LIMIT_LINE, OLD_FUNCTION_LINE], [NEW_FUNCTION_LINE]),
			hunk(OTHER_CODE, [`// josh ${OLD_COMMAND}`]),
		]

		expect(terms(removed, NONE, new Set(['OLD_LIMIT', 'old_name']))).toEqual([COMMAND])
	})
})

describe('prose_stale_scan.stale_terms — a deleted file', () => {
	const DELETED = new Set([CODE])
	const LOCAL_FUNCTION_LINE = 'function count(): number {'

	function deleted_terms(old_lines: Array<string>): Array<Term> {
		return prose_stale_scan.stale_terms([hunk(CODE, old_lines)], NONE, {
			surviving: NONE,
			deleted: DELETED,
		})
	}

	it('drops a local declaration no other file could name', () => {
		expect(deleted_terms([LOCAL_FUNCTION_LINE, 'const LOCAL_LIMIT = 3'])).toEqual([])
	})

	it('keeps a direct export and a member of an exported namespace object', () => {
		const removed = [
			'export const OLD_LIMIT = 3',
			OLD_FUNCTION_LINE,
			LOCAL_FUNCTION_LINE,
			'const space = {',
			'\told_name,',
			'}',
			'export { space }',
		]

		expect(deleted_terms(removed)).toEqual([NAME, { kind: 'name', word: 'space' }, CONSTANT])
	})

	it('keeps a local declaration of a file the change did not delete', () => {
		expect(terms([hunk(CODE, [OLD_FUNCTION_LINE])])).toEqual([NAME])
	})
})

describe('prose_stale_scan.stale_terms — a renamed declaration', () => {
	const RENAMED = { kind: 'name', word: 'old_name', renamed_to: 'new_name' }

	it('takes the old name even when an added comment still carries it as a token', () => {
		const renamed = hunk(CODE, [OLD_FUNCTION_LINE], ['// formerly old_name', NEW_FUNCTION_LINE])

		expect(terms([renamed])).toEqual([RENAMED])
	})

	it('pairs a renamed UPPER_CASE constant as a constant', () => {
		const renamed = hunk(CODE, [OLD_LIMIT_LINE], ['const NEW_LIMIT = 3'])

		expect(terms([renamed])).toEqual([
			{ kind: 'constant', word: 'OLD_LIMIT', renamed_to: 'NEW_LIMIT' },
		])
	})

	it('keeps the old name an added line in another file declares again', () => {
		const moved = [
			hunk(CODE, [OLD_FUNCTION_LINE], [NEW_FUNCTION_LINE]),
			hunk(OTHER_CODE, [], [OLD_FUNCTION_LINE]),
		]

		expect(terms(moved)).toEqual([])
	})

	it('reports a hit of the old name with the name it became', () => {
		const reference = { term: RENAMED, hits: [hit(DOC, 'old_name')], has_failed: false }

		expect(prose_stale_scan.report([reference as Reference]).text).toBe(
			'docs/a.md:3 name old_name (renamed to new_name)',
		)
	})
})

describe('prose_stale_scan.pattern', () => {
	it('searches a heading quoted, as a pointer names it, and any other word whole', () => {
		expect(prose_stale_scan.pattern({ kind: 'heading', word: 'A b' })).toEqual({
			target: '"A b"',
			flags: [],
		})
		expect(prose_stale_scan.pattern({ kind: 'name', word: 'a_b' })).toEqual({
			target: 'a_b',
			flags: ['-w'],
		})
	})
})

describe('prose_stale_scan.report', () => {
	const term: Term = { kind: 'name', word: 'old_name' }

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
				'docs/x.md:3 name old_name',
				'scripts/x.ts:3 name old_name',
				'scripts/y.ts:3 name old_name',
				'.claude/hooks/x.sh:3 name old_name',
			].join('\n'),
			exit_code: 1,
		})
	})

	it('never reads a failed search as none: it is named and exits 2', () => {
		expect(prose_stale_scan.report([reference([], true)])).toEqual({
			text: 'search failed: name old_name',
			exit_code: prose_stale_scan.FAILED_EXIT,
		})
	})
})

// joshuafolkken/kit#6737: "Appended to git's own report" is English, not the removed type.
describe('prose_stale_scan.report — a plain-word name', () => {
	it('lists it only where prose writes it as code', () => {
		const word: Term = { kind: 'name', word: 'Appended' }
		const hits = [
			hit('scripts/git/main-merge-guard.ts', "// Appended to git's own report"),
			hit('docs/p.md', 'Appended lines'),
			hit('docs/q.md', 'see `Appended` and `x`'),
			hit('scripts/p.ts', '// reads event.Appended'),
			hit('scripts/q.ts', '// calls Appended(x)'),
			hit('docs/r.md', '`a` Appended `b`'),
			hit('docs/u.md', 'name, Appended, and owner'),
			hit('docs/v.md', 'we import Appended lines'),
			// A fenced block's lines carry no backticks.
			hit('docs/s.md', "import { x, Appended } from './a'"),
			hit('docs/t.md', "import Appended from './a'"),
		]

		expect(prose_stale_scan.report([{ term: word, hits, has_failed: false }]).text).toBe(
			[
				'docs/q.md:3 name Appended',
				'scripts/p.ts:3 name Appended',
				'scripts/q.ts:3 name Appended',
				'docs/s.md:3 name Appended',
				'docs/t.md:3 name Appended',
			].join('\n'),
		)
	})
})
