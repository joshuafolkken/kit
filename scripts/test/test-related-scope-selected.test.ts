import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { related_scope } from './test-related-scope'

const SELECTED = path.resolve('/repo', 'scripts', 'test', 'test-related.test.ts')

// joshuafolkken/kit#7976: a scope carrying the test files the selection picked hands vitest those
// files alone, whatever its mode.
describe('related_scope.vitest_arguments — the selected test files', () => {
	it('runs the selected test files alone, with the flags, on a narrowed scope', () => {
		const scope = { mode: 'related' as const, files: ['/repo/a.ts'], reason: '', tests: [SELECTED] }

		expect(related_scope.vitest_arguments(scope, ['--silent'])).toEqual([
			'run',
			SELECTED,
			'--silent',
		])
	})

	it('runs the selected test files alone on a whole-suite scope', () => {
		const scope = { mode: 'all' as const, files: [], reason: '', tests: [SELECTED] }

		expect(related_scope.vitest_arguments(scope)).toEqual(['run', SELECTED])
	})
})
