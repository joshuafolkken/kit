import { describe, expect, it } from 'vitest'
import { test_declared } from './test-declared'

// joshuafolkken/kit#2118: the command prints one word to stdout and the reason to stderr, so the
// verdict-to-detail mapping is pinned — `required` names the untested runtime files, `exempt` names the
// exempt paths, `satisfied` says a test changed.

const RUNTIME_FILE = 'scripts/foo.ts'
const UNIT_TEST_FILE = 'scripts/foo.test.ts'

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
