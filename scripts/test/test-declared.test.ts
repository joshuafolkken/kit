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
