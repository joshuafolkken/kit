import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { overrides_check } from './overrides-logic'

// The held-back `typescript` name is what the type-aware ESLint stack and kit's own compiler-API
// scripts resolve, so it must stay on the 6.x API; `tsc` comes from the 7.x alias (kit #5272).
describe('overrides_check — the TypeScript 6 / 7 side-by-side install', () => {
	it('keeps the held-back typescript name on the TypeScript 6 compiler API', () => {
		expect(ts.versionMajorMinor).toMatch(/^6\./u)
		expect(ts.SyntaxKind.SourceFile).toBeTypeOf('number')
	})

	it('does not hold back the TypeScript 7 alias', () => {
		expect(overrides_check.list_excluded_package_names({})).not.toContain('@typescript/native')
	})
})
