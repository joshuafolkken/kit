import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import typescript from 'typescript'
import { afterAll, describe, expect, it } from 'vitest'
import { import_graph } from './import-graph'
import { import_test_inputs } from './import-test-inputs'

const ROOT = mkdtempSync(path.join(tmpdir(), 'josh-closed-inputs-'))
const TEST_NAME = 'unit.test.ts'
const TSCONFIG = 'tsconfig.json'
const TEST = path.join(ROOT, TEST_NAME)
const SOURCE_NAME = 'source.ts'
const SOURCE = path.join(ROOT, SOURCE_NAME)
const PURE_SOURCE = 'export const value = 1'
const NODE_CONFIG = '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"}}'
const PACKAGE_IMPORT = '#value'
const SOURCE_IMPORT = 'import { value } from "./source"; export { value }'

afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true })
})

describe('import_test_inputs', () => {
	it('walks known dependencies with cycles only once', () => {
		writeFileSync(TEST, SOURCE_IMPORT)
		writeFileSync(SOURCE, 'import { value } from "./unit.test"; export { value }')
		const read = import_test_inputs.create(typescript, (_specifier, file) => ({
			file: file === TEST ? SOURCE : TEST,
			external: false,
		}))

		expect(read(TEST)).toEqual([TEST, SOURCE])
	})
	it('refuses a missing transitive source', () => {
		const read = import_test_inputs.create(typescript, () => ({
			file: path.join(ROOT, 'missing.ts'),
			external: false,
		}))

		expect(read(TEST)).toBeUndefined()
	})
	it.each([
		'import(name)',
		'process.env.TZ',
		'fetch("url")',
		'import { expect } from "vitest"; expect(() => { throw new Error("actual") }).toThrowErrorMatchingSnapshot()',
		'import { expect } from "vitest"; expect("actual").matchSnapshot()',
	])('refuses a transitive unknown read: %s', (source) => {
		writeFileSync(SOURCE, source)
		const read = import_test_inputs.create(typescript, () => ({ file: SOURCE, external: false }))

		expect(read(TEST)).toBeUndefined()
	})
})

describe('import_graph.test_inputs — runtime ambiguity', () => {
	it.each([
		['d.ts', 'js'],
		['d.mts', 'mjs'],
		['d.cts', 'cjs'],
		['ts', 'js'],
		['tsx', 'jsx'],
		['mts', 'mjs'],
		['cts', 'cjs'],
	])('refuses type/runtime resolution ambiguity: %s and %s', async (typed, runtime) => {
		const directory = mkdtempSync(path.join(ROOT, 'ambiguous-'))
		const test = path.join(directory, TEST_NAME)

		writeFileSync(path.join(directory, TSCONFIG), '{}')
		writeFileSync(test, `import { value } from "./source.${runtime}"; export { value }`)
		writeFileSync(path.join(directory, `source.${typed}`), PURE_SOURCE)
		writeFileSync(path.join(directory, `source.${runtime}`), PURE_SOURCE)
		const graph = await import_graph.create(directory)

		expect(graph).toBeDefined()
		expect(graph?.test_inputs?.(test)).toBeUndefined()
	})
	it('refuses ambiguous extensionless imports', async () => {
		writeFileSync(TEST, 'import { value } from "./extensionless"; export { value }')
		writeFileSync(path.join(ROOT, TSCONFIG), '{}')
		writeFileSync(path.join(ROOT, 'extensionless.ts'), PURE_SOURCE)
		writeFileSync(path.join(ROOT, 'extensionless.js'), PURE_SOURCE)
		const graph = await import_graph.create(ROOT)

		expect(graph).toBeDefined()
		expect(graph?.test_inputs?.(TEST)).toBeUndefined()
	})
})

describe('import_graph.test_inputs', () => {
	it('resolves actual local imports while refusing unresolved, external and filesystem inputs', async () => {
		writeFileSync(path.join(ROOT, TSCONFIG), '{}')
		writeFileSync(
			TEST,
			'import { expect } from "vitest"; import { value } from "./source"; expect(value).toBe(1)',
		)
		writeFileSync(SOURCE, PURE_SOURCE)
		const graph = await import_graph.create(ROOT)

		expect(graph?.test_inputs?.(TEST)).toEqual([TEST, SOURCE])
		writeFileSync(
			SOURCE,
			'import { readFileSync } from "node:fs"; export const value = readFileSync("data")',
		)
		const changed = await import_graph.create(ROOT)

		expect(changed?.test_inputs?.(TEST)).toBeUndefined()
	})
})

describe('import_graph.test_inputs — conditional imports', () => {
	it('refuses a types condition pointing to a different plain source than runtime', async () => {
		const directory = mkdtempSync(path.join(ROOT, 'conditional-'))
		const test = path.join(directory, TEST_NAME)

		writeFileSync(path.join(directory, TSCONFIG), NODE_CONFIG)
		writeFileSync(
			path.join(directory, 'package.json'),
			JSON.stringify({
				type: 'module',
				imports: { [PACKAGE_IMPORT]: { types: './type-input.ts', default: './runtime-input.ts' } },
			}),
		)
		writeFileSync(test, 'import { value } from "#value"; export { value }')
		writeFileSync(path.join(directory, 'type-input.ts'), PURE_SOURCE)
		writeFileSync(path.join(directory, 'runtime-input.ts'), PURE_SOURCE)
		const graph = await import_graph.create(directory)

		expect(graph).toBeDefined()
		expect(graph?.test_inputs?.(test)).toBeUndefined()
	})
})

describe('import_graph.test_inputs — module suffixes', () => {
	it('refuses a type-checker suffix that can differ from runtime resolution', async () => {
		const directory = mkdtempSync(path.join(ROOT, 'suffix-'))
		const test = path.join(directory, TEST_NAME)

		writeFileSync(
			path.join(directory, TSCONFIG),
			'{"compilerOptions":{"moduleSuffixes":[".native", ""]}}',
		)
		writeFileSync(test, SOURCE_IMPORT)
		writeFileSync(path.join(directory, SOURCE_NAME), PURE_SOURCE)
		writeFileSync(path.join(directory, 'source.native.ts'), PURE_SOURCE)
		const graph = await import_graph.create(directory)

		expect(graph).toBeDefined()
		expect(graph?.test_inputs?.(test)).toBeUndefined()
	})
})
