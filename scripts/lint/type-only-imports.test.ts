import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { type_only_imports } from './type-only-imports'

// joshuafolkken/kit#5368: the module specifiers a transpiler drops with their declaration.
const FILE = 'reader.ts'

describe('type_only_imports.of', () => {
	it('names `import type` and `export type … from` declarations', () => {
		const content = "import type { A } from './a'\nexport type { B } from './b'\n"

		expect(type_only_imports.of(ts, FILE, content)).toStrictEqual(['./a', './b'])
	})

	it('leaves out value imports, inline `type` specifiers and local type exports', () => {
		const content =
			"import { a } from './a'\nimport { type B } from './b'\nexport type { C }\ntype C = 1\n"

		expect(type_only_imports.of(ts, FILE, content)).toStrictEqual([])
	})
})

describe('type_only_imports.runtime_specifiers', () => {
	it('takes each type-only declaration out once, keeping a value import of the same module', () => {
		const content =
			"import type { A } from './a'\nimport { a } from './a'\nimport type { B } from './b'\n"

		expect(type_only_imports.runtime_specifiers(ts, FILE, content)).toStrictEqual(['./a'])
	})

	it('keeps a dynamic import', () => {
		const content = "export async function load(): Promise<unknown> { return import('./c') }\n"

		expect(type_only_imports.runtime_specifiers(ts, FILE, content)).toStrictEqual(['./c'])
	})
})
