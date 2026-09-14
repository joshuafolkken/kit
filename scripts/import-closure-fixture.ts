import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The static value-import closure walker, single-sourced for the two distribution guards that need it
// (joshuafolkken/kit#1997): `distribution-boundary.test.ts` walks the runtime seeds to prove they
// reach no report module, and `pack-boundary.test.ts` walks every distributed command's entry to
// prove its closure is packed. Both resolve `#scripts/*` and relative specifiers against `scripts/`,
// so the walker lives here rather than being copied into each test.
//
// Static imports only. A whole-statement `import type` is erased before it runs, and a dynamic
// `import()` is a sanctioned escape hatch, so neither belongs to the closure this walks.

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_ALIAS = '#scripts/'

// Every module a static value-import in `source` names. Whole-statement `import type` lines are
// dropped first; a mixed `{ value, type X }` import still loads its module at runtime, so keeping its
// specifier is correct. `export … from` re-exports load their module too, so they count.
function value_import_specs(source: string): Array<string> {
	const runtime = source.replaceAll(/import\s+type\s+[^\n]*/gu, '')

	return [...runtime.matchAll(/from\s+['"]([^'"]+)['"]/gu)]
		.map((match) => match[1])
		.filter((spec): spec is string => spec !== undefined)
}

// A bare specifier resolved to a source file inside `scripts/`, or undefined for an external package.
function resolve_spec(spec: string, from_file: string): string | undefined {
	if (spec.startsWith(SCRIPTS_ALIAS)) {
		return path.join(SCRIPTS_DIR, `${spec.slice(SCRIPTS_ALIAS.length)}.ts`)
	}

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
function closure(seeds: Array<string>): Set<string> {
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

const import_closure = { value_import_specs, resolve_spec, imports_of, closure }

export { import_closure, SCRIPTS_DIR }
