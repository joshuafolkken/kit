import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The static value-import closure walker (joshuafolkken/kit#1997). The distribution guards walk it
// from `import-closure-fixture.ts`, and `rule-value-runs.ts` versions its stored run counts by the
// closure's content (joshuafolkken/kit#7134). It resolves `#scripts/*` and relative specifiers
// against `scripts/`; run from `dist/`, `import.meta.url` names this source file
// (`scripts/build/source-location.ts`), so it walks the shipped sources.
//
// Static imports only. A whole-statement `import type` is erased before it runs, and a dynamic
// `import()` is a sanctioned escape hatch, so neither belongs to the closure this walks.

const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
// The kit-only sibling of `scripts/`, which `package.json` `files` does not ship.
const TOOLS_DIR = path.join(SCRIPTS_DIR, '..', 'tools')
const ALIAS_DIRECTORIES: ReadonlyArray<readonly [string, string]> = [
	['#scripts/', SCRIPTS_DIR],
	['#tools/', TOOLS_DIR],
]

// Every module a static value-import in `source` names. Whole-statement `import type` lines are
// dropped first; a mixed `{ value, type X }` import still loads its module at runtime, so keeping its
// specifier is correct. `export … from` re-exports load their module too, so they count.
function value_import_specs(source: string): Array<string> {
	const runtime = source.replaceAll(/import\s+type\s+[^\n]*/gu, '')

	return [...runtime.matchAll(/from\s+['"]([^'"]+)['"]/gu)]
		.map((match) => match[1])
		.filter((spec): spec is string => spec !== undefined)
}

// A bare specifier resolved to a source file inside `scripts/` or `tools/`, or undefined for an
// external package.
function resolve_spec(spec: string, from_file: string): string | undefined {
	const aliased = ALIAS_DIRECTORIES.find(([alias]) => spec.startsWith(alias))

	if (aliased !== undefined) return path.join(aliased[1], `${spec.slice(aliased[0].length)}.ts`)

	if (spec.startsWith('.')) return `${path.resolve(path.dirname(from_file), spec)}.ts`

	return undefined
}

// The scripts-local files one file statically value-imports, external packages dropped.
function imports_of(file: string): Array<string> {
	if (!existsSync(file) || statSync(file).isDirectory()) return []

	return value_import_specs(readFileSync(file, 'utf8'))
		.map((spec) => resolve_spec(spec, file))
		.filter((resolved): resolved is string => resolved !== undefined)
}

// The full static value-import closure, walked breadth-first from every seed file.
function closure(seeds: ReadonlyArray<string>): Set<string> {
	const visited = new Set<string>()
	const queue = [...seeds]

	while (queue.length > 0) {
		const file = queue.shift()
		if (file === undefined || visited.has(file)) continue

		visited.add(file)
		queue.push(...imports_of(file))
	}

	return visited
}

const import_closure = { closure, imports_of }

export { import_closure, SCRIPTS_DIR, TOOLS_DIR }
