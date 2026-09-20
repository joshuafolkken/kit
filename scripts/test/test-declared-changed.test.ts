import { describe, expect, it } from 'vitest'
import { test_declared_changed } from './test-declared-changed'

// joshuafolkken/kit#2118: the sync reader parses `git status --porcelain`, so the two non-trivial
// cases — an untracked file and a rename — are pinned, and the verdict passthrough is pinned with an
// injected path set so the wiring is proved without a checkout.

const NEW_FILE = 'scripts/new.ts'

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
		expect(test_declared_changed.current_verdict(['scripts/foo.ts'])).toBe('required')
		expect(test_declared_changed.current_verdict(['scripts/foo.test.ts'])).toBe('satisfied')
	})
})
