import { describe, expect, it } from 'vitest'
import { test_declared } from './test-declared'

// joshuafolkken/kit#2118: the command prints one word to stdout and the reason to stderr, so the
// verdict-to-detail mapping is pinned — `required` names the untested runtime files, `exempt` names the
// exempt paths, `satisfied` says a test changed.

const RUNTIME_FILE = 'scripts/foo.ts'

describe('test_declared.report', () => {
	it('reports required and names the untested runtime files on the detail', () => {
		const { detail, verdict } = test_declared.report([RUNTIME_FILE])

		expect(verdict).toBe('required')
		expect(detail).toContain('runtime files with no test')
		expect(detail).toContain(RUNTIME_FILE)
	})

	it('reports exempt and names the exempt paths', () => {
		const { detail, verdict } = test_declared.report(['docs/x.md'])

		expect(verdict).toBe('exempt')
		expect(detail).toContain('exempt paths')
		expect(detail).toContain('docs/x.md')
	})

	it('reports satisfied when a test file changed', () => {
		const { detail, verdict } = test_declared.report(['scripts/foo.test.ts'])

		expect(verdict).toBe('satisfied')
		expect(detail).toBe('a test file changed')
	})
})
