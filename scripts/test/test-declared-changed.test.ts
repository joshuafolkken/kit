import { describe, expect, it } from 'vitest'
import { test_declared_changed } from './test-declared-changed'

// joshuafolkken/kit#2118: the sync reader parses `git status --porcelain`, so the two non-trivial
// cases — an untracked file and a rename — are pinned, and the verdict passthrough is pinned with an
// injected path set so the wiring is proved without a checkout.

const NEW_FILE = 'scripts/new.ts'
const RUNTIME_FILE = 'scripts/foo.ts'
const SATISFIED_FILE = 'scripts/foo.test.ts'

function throw_boom(): never {
	throw new Error('boom')
}

describe('test_declared_changed.path_of', () => {
	it('reads the path from an untracked status line', () => {
		expect(test_declared_changed.path_of(`?? ${NEW_FILE}`)).toBe(NEW_FILE)
	})

	it('reads the path from a modified status line', () => {
		expect(test_declared_changed.path_of(' M scripts/x.ts')).toBe('scripts/x.ts')
	})

	it('follows the arrow to the new path of a rename', () => {
		expect(test_declared_changed.path_of(`R  old.ts -> ${NEW_FILE}`)).toBe(NEW_FILE)
	})
})

describe('test_declared_changed.current_verdict', () => {
	it('passes the injected paths through to the verdict', () => {
		expect(test_declared_changed.current_verdict([RUNTIME_FILE])).toBe('required')
		expect(test_declared_changed.current_verdict([SATISFIED_FILE])).toBe('satisfied')
	})
})

// joshuafolkken/kit#2169: the seam the argument-less delivery path needs. The trigger reads the tree
// with no argument, so the swap has to reach the default source rather than a parameter.
describe('test_declared_changed.with_paths', () => {
	it('fixes the argument-less verdict to the injected tree for the span of the body', () => {
		const verdict = test_declared_changed.with_paths([RUNTIME_FILE], () =>
			test_declared_changed.current_verdict(),
		)

		expect(verdict).toBe('required')
	})

	// A nested span proves the restore deterministically and off the live tree: the inner span fixes
	// `required`, and after it returns the outer span's argument-less verdict must read `satisfied` — the
	// inner injection did not persist (joshuafolkken/kit#2169).
	it('restores the previous injection after a nested span returns', () => {
		const verdict = test_declared_changed.with_paths([SATISFIED_FILE], () => {
			test_declared_changed.with_paths([RUNTIME_FILE], () => undefined)

			return test_declared_changed.current_verdict()
		})

		expect(verdict).toBe('satisfied')
	})

	it('restores the previous injection even when the nested span throws', () => {
		const verdict = test_declared_changed.with_paths([SATISFIED_FILE], () => {
			expect(() => test_declared_changed.with_paths([RUNTIME_FILE], throw_boom)).toThrow('boom')

			return test_declared_changed.current_verdict()
		})

		expect(verdict).toBe('satisfied')
	})
})
