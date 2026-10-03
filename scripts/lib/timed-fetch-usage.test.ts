import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#2981: a `fetch` with no time limit holds an unattended run forever when the
// connection stalls, so every request in `scripts/` goes through `timed-fetch.ts`. This walks the
// syntax tree rather than the text, so a `fetch(` inside a string — the child-process script
// `version/npm-registry.ts` runs under its own spawn timeout — is not mistaken for a call.

const SCRIPTS = path.join(process.cwd(), 'scripts')
const HELPER = path.join(SCRIPTS, 'lib', 'timed-fetch.ts')
const SOURCE_SUFFIX = '.ts'
const TEST_SUFFIX = '.test.ts'
const FETCH = 'fetch'
const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(['globalThis', 'window', 'global'])

function runtime_sources(): ReadonlyArray<string> {
	return readdirSync(SCRIPTS, { recursive: true, encoding: 'utf8' })
		.filter((entry) => entry.endsWith(SOURCE_SUFFIX) && !entry.endsWith(TEST_SUFFIX))
		.map((entry) => path.join(SCRIPTS, entry))
}

function is_global_fetch(callee: ts.Expression): boolean {
	if (ts.isIdentifier(callee)) return callee.text === FETCH
	if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== FETCH) return false

	return ts.isIdentifier(callee.expression) && GLOBAL_OBJECTS.has(callee.expression.text)
}

function count_direct_calls(file: string): number {
	const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest)
	let count = 0

	function visit(node: ts.Node): void {
		if (ts.isCallExpression(node) && is_global_fetch(node.expression)) count += 1
		ts.forEachChild(node, visit)
	}

	visit(source)

	return count
}

describe('direct fetch calls in scripts/', () => {
	const sources = runtime_sources()

	it('leaves the timed helper as the only caller of the global fetch', () => {
		const offenders = sources.filter((file) => file !== HELPER && count_direct_calls(file) > 0)

		expect(offenders.map((file) => path.relative(SCRIPTS, file))).toStrictEqual([])
	})

	it('still finds the helper call, so an empty walk cannot pass vacuously', () => {
		expect(sources).toContain(HELPER)
		expect(count_direct_calls(HELPER)).toBe(1)
	})
})
