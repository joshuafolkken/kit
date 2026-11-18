import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { test_symbol_facts, type FileFacts } from './test-symbol-facts'

const FILE = 'main.ts'

const TEXT = `import { helper as assist } from './helper'
import * as all from './all'
import type { Shape } from './types'
export { kept } from './kept'
export * from './star'

function run(): number {
	return assist() + all.count + other.size
}

const bundle = { run, alias: assist }

console.log(run())

export { bundle }
`

function resolve(specifier: string): string | undefined {
	return specifier.startsWith('./') ? `${specifier.slice('./'.length)}.ts` : undefined
}

function facts(): FileFacts {
	return test_symbol_facts.read_file(ts, resolve, FILE, TEXT)
}

describe('test_symbol_facts.read_file — declarations', () => {
	it('records each top-level declaration with its line span and references', () => {
		const run = facts().declarations.get('run')

		expect(run).toEqual({
			start: 7,
			end: 9,
			references: new Set(['run', 'assist', 'all.count', 'other.size']),
		})
	})

	it('records a load-time statement as a declaration named by its line', () => {
		expect(facts().declarations.get(`${test_symbol_facts.LOAD}13`)?.references).toContain('run')
	})

	it('reads the members of an object bundling functions', () => {
		expect(facts().members.get('bundle')).toEqual(
			new Map([
				['run', 'run'],
				['alias', 'assist'],
			]),
		)
	})
})

describe('test_symbol_facts.read_file — imports and exports', () => {
	it('binds runtime imports and skips type-only ones', () => {
		const { imports, modules } = facts()

		expect(imports.get('assist')).toEqual({ module: 'helper.ts', name: 'helper' })
		expect(imports.get('all')).toEqual({ module: 'all.ts', name: test_symbol_facts.EVERY })
		expect(modules.has('types.ts')).toBe(false)
	})

	it('records local exports and named and star re-exports', () => {
		const { exports, reexports } = facts()
		const { EVERY } = test_symbol_facts

		expect(exports).toEqual(new Map([['bundle', 'bundle']]))
		expect(reexports).toEqual([
			{ module: 'kept.ts', name: 'kept', as: 'kept' },
			{ module: 'star.ts', name: EVERY, as: EVERY },
		])
	})
})

const TABLE_TEST = 'table.test.ts'
const TABLE_TEXT = `const KIND = {
	start: 'start',
	stop: 'stop',
}
export default function greet() { return KIND.start }
vi.mock('./whole')
vi.mock('./part', async (importOriginal) => ({ ...(await importOriginal()) }))
export { KIND }
`

function table_facts(): FileFacts {
	return test_symbol_facts.read_file(ts, resolve, TABLE_TEST, TABLE_TEXT)
}

// joshuafolkken/kit#7980: what the walk over declaration users reads past functions and imports.
describe('test_symbol_facts.read_file — literal tables and default exports', () => {
	it('declares each literal-valued property as a member of its own line', () => {
		const { declarations, members } = table_facts()

		expect(declarations.get('KIND.stop')).toEqual({ start: 3, end: 3, references: new Set() })
		expect(members.get('KIND')).toEqual(
			new Map([
				['start', 'KIND.start'],
				['stop', 'KIND.stop'],
			]),
		)
	})

	it('exports a default function by its name and a default expression as itself', () => {
		const expression = test_symbol_facts.read_file(ts, resolve, 'e.ts', 'export default 1 + 2\n')
		const { DEFAULT_EXPORT } = test_symbol_facts

		expect(table_facts().exports.get(DEFAULT_EXPORT)).toBe('greet')
		expect(expression.exports.get(DEFAULT_EXPORT)).toBe(DEFAULT_EXPORT)
		expect(expression.declarations.get(DEFAULT_EXPORT)?.start).toBe(1)
	})
})

describe('test_symbol_facts.read_file — mocks', () => {
	it('records a module mocked whole and reads a partial mock as using every export', () => {
		const { declarations, mocks } = table_facts()
		const every = test_symbol_facts.key_of('part.ts', test_symbol_facts.EVERY)

		expect(mocks).toEqual(new Set(['whole.ts']))
		expect(declarations.get(`${test_symbol_facts.LOAD}7`)?.references).toContain(every)
	})
})

describe('test_symbol_facts keys', () => {
	it('splits a key back into its file and name', () => {
		const key = test_symbol_facts.key_of('a/b.ts', 'name')

		expect([test_symbol_facts.file_of(key), test_symbol_facts.name_of(key)]).toEqual([
			'a/b.ts',
			'name',
		])
	})
})
