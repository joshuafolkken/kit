import { describe, expect, it } from 'vitest'
import { split_assess } from './split-assess'
import { split_assess_cli } from './split-assess-cli'

// joshuafolkken/kit#2218: the size half of the split assessment, measured. The counts exclude test
// files, the verdict needs either guide exceeded (joshuafolkken/kit#5384), and an empty diff is `single`.

const NO_DELETE = '0'
const A_TS = 'scripts/a.ts'
const TAB_PATH = 'scripts/a\tb.ts'
const OBSERVATION_RECORD = '.josh/observations/6391.md'
const GUIDE_TEXT = 'guide 8 files / 200 lines'
const HOOK_SOURCE = '.claude/settings.json'
const HOOK_ARTIFACT = '.codex/hooks.json'

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

// joshuafolkken/kit#6724: the split notice counted a new scripts module and its importer as two files
// while `lane:plan` cleared them as one, so `run:cut` asked to split off the importer.
describe('split notice on lane:plan units', () => {
	it('keeps a registered generated artifact with its source on both estimation and actual measurement', () => {
		const paths = [HOOK_ARTIFACT, HOOK_SOURCE, 'scripts/a.snap', 'docs/list.md']
		const changes = paths.map((path) => ({ path, changed_lines: 6 }))
		const actual = split_assess.assess(paths.map((path) => add_row(6, path)).join('\n'))

		expect(split_assess.measure(changes)).toEqual(actual)
		expect(actual).toMatchObject({ files: 3, lines: 24 })
		expect(split_assess.units_of(paths, new Set())).toContainEqual([HOOK_SOURCE, HOOK_ARTIFACT])
	})
	const new_module = 'scripts/x/new.ts'
	const plan_diff = [
		add_row(1, new_module),
		add_row(1, 'scripts/x/cli.ts'),
		add_row(1, 'docs/a.md'),
		add_row(1, 'scripts/x/b.ts'),
	].join('\n')
	const guide = split_assess.guide_for(12, undefined, { files: 1.5 })
	const declared = { files: 2, lines: 20 }

	it('prints no notice when the new module and its importer count as one', () => {
		const measurement = split_assess.assess(plan_diff, guide, new Set([new_module]))

		expect(measurement.files).toBe(3)
		expect(split_assess.notice(measurement, declared)).toBeUndefined()
	})

	it('still counts each file alone when no file is added', () => {
		const measurement = split_assess.assess(plan_diff, guide)

		expect(measurement.files).toBe(4)
		expect(split_assess.notice(measurement, declared)).toContain('split notice')
	})
})

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
	it.each(['quote"name.test.ts', 'tab\tname.e2e.ts', 'line\nname.test.ts'])(
		'excludes a C-quoted test path: %j',
		(file) => {
			const raw = add_row(201, JSON.stringify(file))

			expect(split_assess.assess(raw)).toStrictEqual({ files: 0, lines: 0, verdict: 'single' })
		},
	)

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

describe('measure excludes run records', () => {
	it.each(['.josh/metrics-accepted/6391.json', OBSERVATION_RECORD])(
		'excludes both counts for %s, including quoted paths',
		(file) => {
			const raw = [add_row(500, file), add_row(500, JSON.stringify(file))].join('\n')

			expect(split_assess.assess(raw)).toEqual({ files: 0, lines: 0, verdict: 'single' })
		},
	)

	it('still warns when deliverables exceed the declared file boundary', () => {
		const raw = [runtime_numstat(3, 1), add_row(500, OBSERVATION_RECORD)].join('\n')
		const measurement = split_assess.assess(raw)

		expect(measurement).toMatchObject({ files: 3, lines: 3 })
		expect(split_assess.notice(measurement, { files: 1, lines: 10 })).toBeDefined()
	})
})

describe('verdict needs either guide exceeded', () => {
	it('splits when files and lines both exceed the guide', () => {
		expect(split_assess.assess(runtime_numstat(9, 40)).verdict).toBe('split')
	})

	it('is single at exactly the guide on both axes', () => {
		expect(split_assess.assess(runtime_numstat(8, 25)).verdict).toBe('single')
	})

	it('splits when only the line guide is exceeded', () => {
		expect(split_assess.assess(runtime_numstat(3, 500)).verdict).toBe('split')
	})

	it('splits when only the file guide is exceeded', () => {
		expect(split_assess.assess(runtime_numstat(9, 1)).verdict).toBe('split')
	})

	it('judges a bare file and line count by the same rule', () => {
		expect(split_assess.verdict_for(9, 200)).toBe('split')
		expect(split_assess.verdict_for(8, 201)).toBe('split')
		expect(split_assess.verdict_for(8, 200)).toBe('single')
	})

	it('is single for an empty diff', () => {
		const measurement = split_assess.assess('')

		expect(measurement).toEqual({ files: 0, lines: 0, verdict: 'single' })
	})
})

describe('is_over_cap is one and a half times the guide', () => {
	it('is under the cap at exactly 12 files / 300 lines', () => {
		expect(split_assess.is_over_cap(12, 300)).toBe(false)
	})

	it('is over the cap past either axis', () => {
		expect(split_assess.is_over_cap(13, 300)).toBe(true)
		expect(split_assess.is_over_cap(12, 301)).toBe(true)
	})
})

describe('reason', () => {
	it('reports the excluded-test counting and the guide on a single verdict', () => {
		const reason = split_assess.reason({ files: 2, lines: 30, verdict: 'single' })

		expect(reason).toContain('2 changed file(s), 30 changed line(s), tests excluded')
		expect(reason).toContain('under the guide on both axes')
	})

	it('says the size condition is met but separability is separate on a split verdict', () => {
		const reason = split_assess.reason({ files: 12, lines: 500, verdict: 'split' })

		expect(reason).toContain('— over the guide —')
		expect(reason).toContain('size condition for a split is met')
		expect(reason).toContain('separability is a separate judgement')
	})
})

// joshuafolkken/kit#4302: the pre-gate notice fires past the guide when the Issue declares no size.
describe('notice', () => {
	// joshuafolkken/kit#6602: size alone is a warning; a split child is only for an independent requirement.
	it('names the measurement as a warning that never splits the started Issue', () => {
		const notice = split_assess.notice({ files: 12, lines: 500, verdict: 'split' })

		expect(notice).toContain('12 changed file(s), 500 changed line(s)')
		expect(notice).toContain('a warning, not a stop: go on')
		expect(notice).not.toContain('stop implementation')
		expect(notice).not.toContain(split_assess.REASON_PREFIX)
		expect(notice).not.toContain('--route split')
		expect(notice).toContain('records the overrun as a pre-split miss')
		expect(notice).toContain('Over the guide before the gate')
	})

	it('prints nothing at the guide on both axes', () => {
		expect(split_assess.notice({ files: 8, lines: 200, verdict: 'single' })).toBeUndefined()
	})

	it('falls back to the guide for a declaration of zero files', () => {
		const declared = { files: 0, lines: 0 }

		expect(
			split_assess.notice({ files: 8, lines: 200, verdict: 'single' }, declared),
		).toBeUndefined()
		expect(split_assess.notice({ files: 9, lines: 10, verdict: 'split' }, declared)).toContain(
			GUIDE_TEXT,
		)
	})
})

// joshuafolkken/kit#6206: a declared size moves the bar to the declaration grown by the factor.
describe('notice against a declared size', () => {
	const DECLARED = { files: 3, lines: 40 }

	it('fires at 7 files, past 3 declared files × 2', () => {
		const notice = split_assess.notice({ files: 7, lines: 40, verdict: 'single' }, DECLARED)

		expect(notice).toContain('declared 3 files / 40 lines; growth files × 2 (fallback)')
		expect(notice).toContain('= 6 files / 80 lines')
	})

	it('fires at 81 lines, past 40 declared lines × 2', () => {
		expect(split_assess.notice({ files: 1, lines: 81, verdict: 'single' }, DECLARED)).toBeDefined()
	})

	it('prints nothing at the grown bar on both axes', () => {
		expect(
			split_assess.notice({ files: 6, lines: 80, verdict: 'single' }, DECLARED),
		).toBeUndefined()
	})
})

// A declaration never lifts the bar past the guide, which held before the declaration counted.
describe('notice against a declaration grown past the guide', () => {
	it('caps a declaration grown past the guide at the guide', () => {
		const notice = split_assess.notice(
			{ files: 9, lines: 40, verdict: 'split' },
			{ files: 8, lines: 200 },
		)

		expect(notice).toContain(GUIDE_TEXT)
	})

	it('caps only the axis grown past the guide', () => {
		const notice = split_assess.notice(
			{ files: 1, lines: 201, verdict: 'split' },
			{ files: 3, lines: 150 },
		)

		expect(notice).toContain('lines × 2 (fallback), capped at the guide = 6 files / 200 lines')
	})

	it('falls back to the guide for a declaration of zero lines', () => {
		expect(
			split_assess.notice({ files: 1, lines: 1, verdict: 'single' }, { files: 2, lines: 0 }),
		).toBeUndefined()
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
