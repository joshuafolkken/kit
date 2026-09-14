import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The distribution boundary (joshuafolkken/kit#1996): the runtime analysis kit distributes —
// everything under `time-runtime/` and `cost-runtime/`, reached by consumers through commands, hooks,
// guards and `josh cost --over` — must never statically import a kit-only measurement report. The
// reports were split into their own directories (`time/`, `cost/`) precisely so this check is a
// directory rule rather than an allow-list: no file the runtime statically pulls in may live there.
//
// Static imports only. A whole-statement `import type` is erased before it runs, and a dynamic
// `import()` is the sanctioned escape hatch `cost-cli` uses to reach the report path, so neither
// belongs to the runtime closure this walks.

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_ALIAS = '#scripts/'
const TIME_RUNTIME = 'time-runtime'
const COST_RUNTIME = 'cost-runtime'
const RUNTIME_DIRS = [TIME_RUNTIME, COST_RUNTIME]
const REPORT_DIRS = ['time', 'cost']

// Every module a static value-import in `source` names. Whole-statement `import type` lines are
// dropped first; a mixed `{ value, type X }` import still loads its module at runtime, so keeping
// its specifier is correct. `export … from` re-exports load their module too, so they count.
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

function seed_files(): Array<string> {
	return RUNTIME_DIRS.flatMap((directory) =>
		readdirSync(path.join(SCRIPTS_DIR, directory))
			.filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
			.map((entry) => path.join(SCRIPTS_DIR, directory, entry)),
	)
}

function is_report_file(file: string): boolean {
	const relative = path.relative(SCRIPTS_DIR, file)

	return REPORT_DIRS.some((directory) => relative.startsWith(`${directory}${path.sep}`))
}

// The scripts-local files one file statically value-imports, external packages dropped.
function imports_of(file: string): Array<string> {
	if (!existsSync(file) || statSync(file).isDirectory()) return []

	return value_import_specs(readFileSync(file, 'utf8'))
		.map((spec) => resolve_spec(spec, file))
		.filter((resolved): resolved is string => resolved !== undefined)
}

// The full static value-import closure of the runtime, walked breadth-first from every runtime file.
function runtime_closure(): Set<string> {
	const visited = new Set<string>()
	const queue = seed_files()

	while (queue.length > 0) {
		const file = queue.shift()
		if (file === undefined || visited.has(file)) continue

		visited.add(file)
		queue.push(...imports_of(file))
	}

	return visited
}

describe('the distributed runtime closure', () => {
	const closure = runtime_closure()

	it('is walked from a non-empty runtime, reaching its own foundation', () => {
		expect(seed_files().length).toBeGreaterThan(0)
		expect(closure.has(path.join(SCRIPTS_DIR, TIME_RUNTIME, 'time-spans.ts'))).toBe(true)
		expect(closure.has(path.join(SCRIPTS_DIR, COST_RUNTIME, 'cost-corpus.ts'))).toBe(true)
	})

	it('reaches no kit-only report module under time/ or cost/', () => {
		const reached_reports = [...closure]
			.filter((file) => is_report_file(file))
			.map((file) => path.relative(SCRIPTS_DIR, file))

		expect(reached_reports).toEqual([])
	})
})
