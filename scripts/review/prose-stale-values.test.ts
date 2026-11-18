import type { Hit } from '#scripts/git/git-grep-hits'
import type { Hunk } from '#scripts/test/test-pinned-logic'
import { describe, expect, it } from 'vitest'
import { prose_stale_scan, type Reference, type Term } from './prose-stale-scan'
import { prose_stale_values } from './prose-stale-values'

// joshuafolkken/kit#7881: a changed value's old literal and a removed `--flag`, and the rule that keeps
// an old value used in another sense from being reported.

const CODE = 'scripts/a.ts'
const TEST = 'scripts/a.test.ts'
const DOC = 'docs/a.md'
const NONE: ReadonlySet<string> = new Set()
const EXIT = 'FAILED_EXIT'
const OLD_EXIT = `export const ${EXIT} = 2`
const NEW_EXIT = `export const ${EXIT} = 3`
const VALUE: Term = { kind: 'value', word: '2', renamed_to: '3', constant: EXIT, file: CODE }
const MODE: Term = {
	kind: 'value',
	word: 'strict',
	renamed_to: 'loose',
	constant: 'MODE',
	file: CODE,
}
const FLAG: Term = { kind: 'flag', word: '--period' }
const EXIT_COMMENT = '// exits 2 on a failure'

function hunk(file: string, old_lines: Array<string>, new_lines: Array<string> = []): Hunk {
	return { file, new_start: 1, new_count: new_lines.length, old_lines, new_lines }
}

function terms(hunks: Array<Hunk>, surviving = NONE): Array<Term> {
	return prose_stale_scan.stale_terms(hunks, NONE, { surviving, deleted: NONE })
}

function reported(term: Term, excerpt: string, path = DOC): string {
	const hit: Hit = { path, line: '3', excerpt }
	const reference: Reference = { term, hits: [hit], has_failed: false }

	return prose_stale_scan.report([reference]).text
}

describe('prose_stale_values.changed', () => {
	it('pairs a constant whose literal a hunk changed with what it now holds', () => {
		expect(prose_stale_values.changed([hunk(CODE, [OLD_EXIT], [NEW_EXIT])])).toStrictEqual([
			{ file: CODE, constant: EXIT, before: '2', after: '3' },
		])
	})

	it('reads a typed declaration, a string and a digit-grouped number', () => {
		const old_lines = ["const MODE: Mode = 'strict'", 'const BUDGET_MS = 60_000']
		const new_lines = ["const MODE: Mode = 'loose'", 'const BUDGET_MS = 90_000']

		expect(prose_stale_values.changed([hunk(CODE, old_lines, new_lines)])).toStrictEqual([
			{ file: CODE, constant: 'MODE', before: 'strict', after: 'loose' },
			{ file: CODE, constant: 'BUDGET_MS', before: '60000', after: '90000' },
		])
	})

	it('skips an unchanged value, a removed constant, a non-literal, an indented local and a flag value', () => {
		const same = 'const SAME = 3'
		const old_lines = [
			same,
			'const GONE = 4',
			'const CALL = f(5)',
			'  const LOCAL = 6',
			"const FLAG = '--old'",
		]
		const new_lines = [same, 'const CALL = f(7)', '  const LOCAL = 9', "const FLAG = '--new'"]

		expect(prose_stale_values.changed([hunk(CODE, old_lines, new_lines)])).toStrictEqual([])
	})
})

describe('prose_stale_values.flags', () => {
	it('reads every --flag token a line writes, and not a decrement', () => {
		expect(
			prose_stale_values.flags(["if (args.includes('--dry-run') || i-- > 0) x('--period')"]),
		).toStrictEqual(['--dry-run', '--period'])
	})
})

describe('prose_stale_scan.stale_terms (values and flags)', () => {
	it('names a changed value and a removed flag of a code file', () => {
		const old_lines = [OLD_EXIT, "const PERIOD = args.includes('--period')"]
		const new_lines = [NEW_EXIT, "const PERIOD = args.includes('--days')"]
		const found = terms([hunk(CODE, old_lines, new_lines)])

		expect(found).toContainEqual(FLAG)
		expect(found).toContainEqual(VALUE)
	})

	it('keeps a flag an added line or live code still writes, and reads no test file', () => {
		const moved = hunk(CODE, ["x('--period')"], ["y('--period')"])
		const live = hunk(CODE, ["x('--live')"])
		const test = hunk(TEST, [OLD_EXIT, "x('--test')"], [NEW_EXIT])

		expect(terms([moved, live, test], new Set(['--live']))).toStrictEqual([])
	})
})

describe('prose_stale_scan.report (values and flags)', () => {
	it('reports an old number on a line naming its constant or the stem of each of its words', () => {
		expect(reported(VALUE, 'Exits 2 when a search failed.')).toBe(
			`${DOC}:3 value 2 (${EXIT} now 3)`,
		)
		expect(reported(VALUE, `\`${EXIT}\` is 2.`)).not.toBe('ok')
		expect(reported(VALUE, EXIT_COMMENT, CODE)).not.toBe('ok')
	})

	it('drops an old number used in another sense', () => {
		expect(reported(VALUE, 'Another command exits `2` and says so.')).toBe('ok')
		expect(reported(VALUE, 'It failed 2 of 10 readings.')).toBe('ok')
		expect(reported(VALUE, 'A failed exit on node 1.2, issue #2 or v2/exits.')).toBe('ok')
		expect(reported(VALUE, 'Exits 12 when a search failed.')).toBe('ok')
		expect(reported(VALUE, EXIT_COMMENT, 'scripts/other.ts')).toBe('ok')
	})

	it('reports an old string only quoted, in backticks or beside its constant', () => {
		expect(reported(MODE, 'Runs in `strict` mode.')).not.toBe('ok')
		expect(reported(MODE, "Set MODE to 'strict'.")).not.toBe('ok')
		expect(reported(MODE, 'A strict reading of the rule.')).toBe('ok')
	})

	it('reports a flag only as a whole --flag token', () => {
		expect(reported(FLAG, 'Run `josh lane:stats --period 7`.')).toBe(`${DOC}:3 flag --period`)
		expect(reported(FLAG, 'Pass --period-days instead.')).toBe('ok')
	})
})
