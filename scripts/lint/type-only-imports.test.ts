import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { type_only_imports } from './type-only-imports'

// joshuafolkken/kit#5368: the module specifiers left once a transpiler drops the type-only declarations.
const FILE = 'reader.ts'

function runtime_of(content: string): Array<string> {
	return type_only_imports.runtime_specifiers(ts, FILE, content)
}

describe('type_only_imports.runtime_specifiers', () => {
	it('drops `import type` and `export type … from` declarations', () => {
		expect(
			runtime_of("import type { A } from './a'\nexport type { B } from './b'\n"),
		).toStrictEqual([])
	})

	it('keeps value imports and inline `type` specifiers', () => {
		expect(runtime_of("import { a } from './a'\nimport { type B } from './b'\n")).toStrictEqual([
			'./a',
			'./b',
		])
	})

	it.each([
		[
			'a value import beside an `import type`',
			"import type { A } from './a'\nimport { a } from './a'\n",
		],
		[
			'a value import beside an `export type * as`',
			"export type * as ns from './a'\nimport { x } from './a'\n",
		],
		[
			'a dynamic import beside an `import type`',
			"import type { A } from './a'\nexport async function load(): Promise<A> { return import('./a') }\n",
		],
	])('keeps %s of the same module', (_kind, content) => {
		expect(runtime_of(content)).toStrictEqual(['./a'])
	})
})
