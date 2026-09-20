import { describe, expect, it } from 'vitest'
import { split_assess } from './split-assess'
import { split_assess_cli } from './split-assess-cli'

// joshuafolkken/kit#2218: the size half of the split assessment, measured. The counts exclude test
// files, the verdict needs both guides exceeded, and an empty diff is `single`.

const NO_DELETE = '0'
const A_TS = 'scripts/a.ts'
const TAB_PATH = 'scripts/a\tb.ts'

// A numstat row: added, deleted, path.
function row(added: string, deleted: string, path: string): string {
	return `${added}\t${deleted}\t${path}`
}

// A numstat row of `lines` additions and no deletions at `path`.
function add_row(lines: number, path: string): string {
	return row(String(lines), NO_DELETE, path)
}

// A numstat body of N runtime files, each contributing `lines` changed lines (all as additions).
function runtime_numstat(count: number, lines: number): string {
	return Array.from({ length: count }, (_unused, index) =>
		add_row(lines, `scripts/thing-${String(index)}.ts`),
	).join('\n')
}

describe('parse_numstat', () => {
	it('sums added and deleted into changed lines', () => {
		const [change] = split_assess.parse_numstat(row('12', '5', A_TS))

		expect(change).toEqual({ path: A_TS, changed_lines: 17 })
	})

	it('reads a binary row (- / -) as zero changed lines', () => {
		const [change] = split_assess.parse_numstat(row('-', '-', 'assets/logo.png'))

		expect(change?.changed_lines).toBe(0)
	})

	it('keeps a tab in a quoted-off path intact', () => {
		const [change] = split_assess.parse_numstat(row('1', NO_DELETE, TAB_PATH))

		expect(change?.path).toBe(TAB_PATH)
	})

	it('drops blank lines and malformed rows', () => {
		expect(split_assess.parse_numstat('\n1\t2\n')).toEqual([])
	})
})

describe('measure excludes test files from both counts', () => {
	it('drops *.test.ts and *.e2e.ts from files and lines', () => {
		const raw = [
			add_row(40, A_TS),
			add_row(500, 'scripts/a.test.ts'),
			add_row(500, 'scripts/a.e2e.ts'),
		].join('\n')
		const measurement = split_assess.assess(raw)

		expect(measurement).toMatchObject({ files: 1, lines: 40 })
	})
})

describe('verdict needs both guides exceeded', () => {
	it('splits when files and lines both exceed the guide', () => {
		expect(split_assess.assess(runtime_numstat(11, 40)).verdict).toBe('split')
	})

	it('is single at exactly the guide on both axes', () => {
		expect(split_assess.assess(runtime_numstat(10, 40)).verdict).toBe('single')
	})

	it('is single when only the line guide is exceeded', () => {
		expect(split_assess.assess(runtime_numstat(3, 500)).verdict).toBe('single')
	})

	it('is single when only the file guide is exceeded', () => {
		expect(split_assess.assess(runtime_numstat(11, 1)).verdict).toBe('single')
	})

	it('is single for an empty diff', () => {
		const measurement = split_assess.assess('')

		expect(measurement).toEqual({ files: 0, lines: 0, verdict: 'single' })
	})
})

describe('reason', () => {
	it('reports the excluded-test counting and the guide on a single verdict', () => {
		const reason = split_assess.reason({ files: 2, lines: 30, verdict: 'single' })

		expect(reason).toContain('2 changed file(s), 30 changed line(s), tests excluded')
		expect(reason).toContain('under the guide')
	})

	it('says the size condition is met but separability is separate on a split verdict', () => {
		const reason = split_assess.reason({ files: 12, lines: 500, verdict: 'split' })

		expect(reason).toContain('size condition for a split is met')
		expect(reason).toContain('separability is a separate judgement')
	})
})

describe('cli flag parsing', () => {
	it('reads --json', () => {
		expect(split_assess_cli.parse_is_json(['--json'])).toBe(true)
	})

	it('defaults to non-json with no flags', () => {
		expect(split_assess_cli.parse_is_json([])).toBe(false)
	})

	it('rejects an unknown flag', () => {
		expect(split_assess_cli.parse_is_json(['--nope'])).toBeUndefined()
	})
})
