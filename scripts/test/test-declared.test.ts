import { report_format_reference } from '#scripts/report/report-format-reference'
import { describe, expect, it, vi } from 'vitest'
import { test_declared } from './test-declared'

// joshuafolkken/kit#2118: the command prints one word to stdout and the reason to stderr, so the
// verdict-to-detail mapping is pinned — `required` names the untested runtime files, `exempt` names the
// exempt paths, `satisfied` says a test changed.

const RUNTIME_FILE = 'scripts/foo.ts'
const UNIT_TEST_FILE = 'scripts/foo.test.ts'
const RUN_CHECK = 'run the changed code by hand'

// joshuafolkken/kit#2820: a basic-profile exemption names the manual check it owes — a browser for
// HTML/CSS, a manual run for a source kit cannot test, and nothing for documentation.
describe('test_declared.report manual-check instructions', () => {
	it('explains manual browser confirmation for basic-profile HTML and CSS', () => {
		const result = test_declared.report(['index.html', 'site.css'], true)

		expect(result.verdict).toBe('exempt')
		expect(result.detail).toContain('confirm the rendered page in a browser')
		expect(result.detail).not.toContain(RUN_CHECK)
	})

	it('explains a manual run for a basic-profile source kit cannot test', () => {
		const result = test_declared.report(['main.lua'], true)

		expect(result.verdict).toBe('exempt')
		expect(result.detail).toContain('main.lua')
		expect(result.detail).toContain(RUN_CHECK)
		expect(result.detail).not.toContain('browser')
	})

	it('reads an upper-case HTML suffix as a page for the browser check', () => {
		const { detail } = test_declared.report(['Index.HTML'], true)

		expect(detail).toContain('browser')
		expect(detail).not.toContain(RUN_CHECK)
	})

	it('gives no manual instruction for a documentation-only change', () => {
		expect(test_declared.report(['docs/x.md'], true).detail).toBe('exempt paths: docs/x.md')
	})
})

describe('test_declared.report', () => {
	it('reports required and names the untested runtime files on the detail', () => {
		const { detail, verdict } = test_declared.report([RUNTIME_FILE])

		expect(verdict).toBe('required')
		expect(detail).toContain('runtime files with no test')
		expect(detail).toContain(RUNTIME_FILE)
	})

	it('names the test type each untested runtime file calls for', () => {
		const { detail } = test_declared.report([RUNTIME_FILE, 'src/routes/x/+page.svelte'])

		expect(detail).toContain(`Unit — ${RUNTIME_FILE}`)
		expect(detail).toContain('E2E — src/routes/x/+page.svelte')
	})

	it('reports exempt and names the exempt paths', () => {
		const { detail, verdict } = test_declared.report(['docs/x.md'])

		expect(verdict).toBe('exempt')
		expect(detail).toContain('exempt paths')
		expect(detail).toContain('docs/x.md')
	})

	it('reports satisfied when a test file changed', () => {
		const { detail, verdict } = test_declared.report([UNIT_TEST_FILE])

		expect(verdict).toBe('satisfied')
		expect(detail).toBe('a test file changed')
	})
})

describe('test_declared match mode', () => {
	const UNIT_LINE = `Extract — Test: Unit — ${RUNTIME_FILE} — verifies it`

	it('exits clean when every declaration matches', () => {
		expect(test_declared.run_match(UNIT_LINE, [RUNTIME_FILE, UNIT_TEST_FILE])).toBe(0)
	})

	it('exits non-zero when a declaration mismatches', () => {
		expect(test_declared.run_match(UNIT_LINE, [RUNTIME_FILE])).toBe(1)
	})

	it('exits non-zero when the summary parses to no declarations', () => {
		expect(test_declared.run_match('■ 概要\n- prose only', [RUNTIME_FILE])).toBe(1)
	})

	it('formats a result as status, type and path', () => {
		expect(
			test_declared.format_match({
				declared_type: 'Unit',
				path: RUNTIME_FILE,
				status: 'test-not-created',
			}),
		).toBe(`test-not-created: Unit — ${RUNTIME_FILE}`)
	})
})

// joshuafolkken/kit#3422: `path-missing` said the path was not in the change set but not what it
// probably meant or where the line's shape is written, so the summary was rewritten by guesswork.
describe('test_declared.format_match — path-missing hints', () => {
	const MISSING = { declared_type: 'Unit', path: 'foo.ts', status: 'path-missing' } as const
	const SHAPE = report_format_reference.pointer(report_format_reference.SUMMARY_RULES_HEADING)

	it('names the changed paths with the same file name and the shape of the line', () => {
		const printed = test_declared.format_match(MISSING, [RUNTIME_FILE, UNIT_TEST_FILE])

		expect(printed).toBe(
			[
				'path-missing: Unit — foo.ts',
				`  changed with the same file name: ${RUNTIME_FILE}`,
				`  the declaration line's shape: ${SHAPE}`,
			].join('\n'),
		)
	})

	it('omits the candidate line when no changed path shares the file name', () => {
		const printed = test_declared.format_match(MISSING, [UNIT_TEST_FILE])

		expect(printed).not.toContain('changed with the same file name')
		expect(printed).toContain(SHAPE)
	})

	it('adds no hint to a status other than path-missing', () => {
		const printed = test_declared.format_match({ ...MISSING, status: 'match' }, [RUNTIME_FILE])

		expect(printed).toBe('match: Unit — foo.ts')
	})

	it('hands the change set to the hint when run over a summary', () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		test_declared.run_match('Extract — Test: Unit — foo.ts — verifies it', [RUNTIME_FILE])
		const printed = write.mock.calls.map(([chunk]) => String(chunk)).join('')

		write.mockRestore()
		expect(printed).toContain(`  changed with the same file name: ${RUNTIME_FILE}`)
	})
})

// joshuafolkken/kit#2297: an unknown flag is refused rather than ignored, `--help` prints the usage
// (including the `--match` stdin form), and a `required` verdict names the one command to run next.
describe('test_declared flag parsing', () => {
	it('rejects an unknown flag rather than re-printing the verdict', () => {
		expect(test_declared.parse(['--bogus'])).toBeUndefined()
	})

	it('parses --help', () => {
		expect(test_declared.parse(['--help'])).toStrictEqual({ is_help: true, is_match: false })
	})

	it('parses --match', () => {
		expect(test_declared.parse(['--match'])).toStrictEqual({ is_help: false, is_match: true })
	})

	it('defaults to no flags on an empty argv', () => {
		expect(test_declared.parse([])).toStrictEqual({ is_help: false, is_match: false })
	})

	it('prints the --match stdin form in its usage', () => {
		expect(test_declared.USAGE).toContain('--match')
		expect(test_declared.USAGE).toContain('pnpm josh test:declared --match < summary.md')
	})
})

describe('test_declared.next_step', () => {
	it('names the next command for a required verdict', () => {
		expect(test_declared.next_step('required')).toContain('--match')
	})

	it('leaves nothing to run next for exempt or satisfied', () => {
		expect(test_declared.next_step('exempt')).toBeUndefined()
		expect(test_declared.next_step('satisfied')).toBeUndefined()
	})
})
