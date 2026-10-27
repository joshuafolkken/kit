import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { related_scope } from './test-related-scope'

const ROOT = path.resolve('/repo')

// joshuafolkken/kit#4465: the name a `josh test:related` run is recorded under in the lane ledger.
describe('related_scope.scope_kind', () => {
	it('names a narrowed or no-test scope by its mode', () => {
		expect(related_scope.scope_kind({ mode: 'related', files: [], reason: '' })).toBe('related')
		expect(related_scope.scope_kind({ mode: 'none', files: [], reason: '' })).toBe('none')
	})

	it('names a full-suite scope by the kind of its reason, the one fallback_kind reads', () => {
		const scope = { mode: 'all' as const, files: [], reason: related_scope.NO_MAP_REASON }

		expect(related_scope.scope_kind(scope)).toBe('no-map')
		expect(related_scope.fallback_kind(related_scope.describe_scope(scope, ROOT))).toBe('no-map')
	})
})
