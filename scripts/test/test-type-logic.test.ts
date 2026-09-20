import { describe, expect, it } from 'vitest'
import { test_type_logic } from './test-type-logic'

// joshuafolkken/kit#2181: the test type is decided from the path alone, so it is pinned as one — a
// change under `src/routes/` is E2E, every other runtime path is Unit, matching testing-guide.md §1.

describe('test_type_logic.test_type_for', () => {
	it('is E2E for a route page', () => {
		expect(test_type_logic.test_type_for('src/routes/foo/+page.svelte')).toBe('E2E')
	})

	it('is E2E for a route server module', () => {
		expect(test_type_logic.test_type_for('src/routes/foo/+page.server.ts')).toBe('E2E')
	})

	it('is Unit for a utility', () => {
		expect(test_type_logic.test_type_for('scripts/foo.ts')).toBe('Unit')
	})

	it('is Unit for a server library module outside routes', () => {
		expect(test_type_logic.test_type_for('src/lib/server/db.ts')).toBe('Unit')
	})

	it('is Unit for a display-only component outside routes', () => {
		expect(test_type_logic.test_type_for('src/lib/Badge.svelte')).toBe('Unit')
	})

	it('ignores surrounding whitespace', () => {
		expect(test_type_logic.test_type_for('  src/routes/x/+page.svelte  ')).toBe('E2E')
	})
})
