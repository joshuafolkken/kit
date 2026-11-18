import { describe, expect, it } from 'vitest'
import { test_symbol_resolve } from './test-symbol-resolve'

const UTIL = 'src/lib/util.ts'
const CARD = 'src/Card.svelte'
const B_FILE = 'scripts/a/b.ts'
const C_INDEX = 'scripts/a/c/index.ts'
const X_FILE = 'scripts/git/x.ts'
const RULE = 'eslint/rule.config.js'
const FILES = [UTIL, CARD, B_FILE, C_INDEX, X_FILE, RULE]
const FROM = 'scripts/a/main.ts'

const resolve = test_symbol_resolve.resolver(
	FILES.map((file) => ({ file })),
	{ '#scripts/*': './scripts/*.ts', '#eslint/*': './eslint/*' },
)

describe('test_symbol_resolve.resolver', () => {
	it('resolves a relative specifier with or without its written extension', () => {
		expect(resolve('./b', FROM)).toBe(B_FILE)
		expect(resolve('./b.js', FROM)).toBe(B_FILE)
	})

	it('resolves a directory to its index', () => {
		expect(resolve('./c', FROM)).toBe(C_INDEX)
	})

	it('resolves $lib to src/lib and a component by its written extension', () => {
		expect(resolve('$lib/util', 'src/routes/page.ts')).toBe(UTIL)
		expect(resolve('../Card.svelte', UTIL)).toBe(CARD)
	})

	it('resolves a package.json import alias, a dotted name included', () => {
		expect(resolve('#scripts/git/x', FROM)).toBe(X_FILE)
		expect(resolve('#eslint/rule.config.js', FROM)).toBe(RULE)
	})

	it('resolves a package import or a missing file to nothing', () => {
		expect(resolve('zod', FROM)).toBeUndefined()
		expect(resolve('./missing', FROM)).toBeUndefined()
	})
})
