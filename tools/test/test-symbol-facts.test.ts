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

describe('test_symbol_facts keys', () => {
	it('splits a key back into its file and name', () => {
		const key = test_symbol_facts.key_of('a/b.ts', 'name')

		expect([test_symbol_facts.file_of(key), test_symbol_facts.name_of(key)]).toEqual([
			'a/b.ts',
			'name',
		])
	})
})
