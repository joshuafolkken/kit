import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { test_symbol_bindings, type BindingSpan } from './test-symbol-bindings'
import { test_symbol_facts } from './test-symbol-facts'

// joshuafolkken/kit#7980: each import and re-export statement keeps its span and what it binds.
const TEXT = `import {
	one,
	two as second,
} from './lib'
import type { Shape } from './types'
export { kept } from './kept'
export * from './star'
`

function resolve(specifier: string): string | undefined {
	return specifier.startsWith('./') ? `${specifier.slice('./'.length)}.ts` : undefined
}

function spans(): Array<BindingSpan> {
	return test_symbol_facts.read_file(ts, resolve, 'main.ts', TEXT).spans
}

describe('test_symbol_bindings.read_binding', () => {
	it('keeps an import across lines with the local names it binds', () => {
		expect(spans()[0]).toEqual({ start: 1, end: 4, imports: ['one', 'second'], reexports: [] })
	})

	it('keeps a type-only import with no name bound', () => {
		expect(spans()[1]).toMatchObject({ start: 5, imports: [] })
	})

	it('keeps each re-export with the names it passes on', () => {
		const { EVERY } = test_symbol_bindings

		expect(spans().slice(2)).toEqual([
			{
				start: 6,
				end: 6,
				imports: [],
				reexports: [{ module: 'kept.ts', name: 'kept', as: 'kept' }],
			},
			{ start: 7, end: 7, imports: [], reexports: [{ module: 'star.ts', name: EVERY, as: EVERY }] },
		])
	})
})
