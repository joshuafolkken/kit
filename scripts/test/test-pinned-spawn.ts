import path from 'node:path'
import type { ImportGraph } from '#scripts/lint/import-graph'
import { test_declared_logic } from './test-declared-logic'

// The code a test can run past its import closure (joshuafolkken/kit#5261, joshuafolkken/kit#6433): a test starts a CLI
// by naming its file in a string, so a file a string literal of the test or of a module it imports
// names is one it may start, and so is a file the strings that one runs name in turn — the command a
// spawned dispatcher starts by its path. The reverse lookup selects native entries named directly
// by a test, with their runtime imports. Import closures can name distribution assets rather than
// executions, so only the conservative red basis follows their strings. These, with their closures,
// are what a `josh
// test:pinned` red rests on besides the test's own closure; an edit to code nothing named reaches
// leaves the red held. A comment starts nothing, so its file names are not read.
//
// A name is a file's whole base name in one string or template span, so a file named by another with
// the same base name counts too, erring toward re-probing. A name built across template spans or
// written without its extension is not read, so a fix to that CLI leaves its red held.

const TOKEN = /[\w.-]+/gu

interface TestSpawn {
	started: (tests: ReadonlyArray<string>) => ReadonlySet<string>
	related: (file: string) => ReadonlyArray<string>
}

// Each non-test code file of `universe` under its base name.
function index_of(universe: ReadonlyArray<string>): Map<string, Array<string>> {
	const index = new Map<string, Array<string>>()

	for (const file of universe) {
		if (test_declared_logic.is_test_file(path.relative(process.cwd(), file))) continue
		const name = path.basename(file)

		index.set(name, [...(index.get(name) ?? []), file])
	}

	return index
}

function names_in(text: string, index: ReadonlyMap<string, ReadonlyArray<string>>): Array<string> {
	return (text.match(TOKEN) ?? []).flatMap((token) => index.get(token) ?? [])
}

// `read` answered once per file for the graph's lifetime, however many reds ask it.
function memoized(read: (file: string) => Array<string>): (file: string) => Array<string> {
	const known = new Map<string, Array<string>>()

	return function answer(file: string): Array<string> {
		const found = known.get(file) ?? read(file)

		known.set(file, found)

		return found
	}
}

function reader_of(
	graph: ImportGraph,
	names_of: (file: string) => Array<string>,
): (file: string) => Array<string> {
	// What `file` runs names: its own strings and those of every module its imports reach.
	return memoized((file) => [
		...new Set([file, ...graph.closure(file)].flatMap((read) => names_of(read))),
	])
}

function reverse_of(
	graph: ImportGraph,
	universe: ReadonlyArray<string>,
	names_of: (file: string) => Array<string>,
): TestSpawn['related'] {
	const tests = universe.filter((file) => test_declared_logic.is_test_file(file))

	return function related(file: string): ReadonlyArray<string> {
		const importers = graph.runtime_importers([file], universe)

		return tests.filter((test) => names_of(test).some((entry) => importers.has(entry)))
	}
}

function create(graph: ImportGraph, universe: ReadonlyArray<string>): TestSpawn {
	const index = index_of(universe)
	const names_of = memoized((file) => names_in(graph.strings(file).join(' '), index))
	const named_from = reader_of(graph, names_of)

	function started(tests: ReadonlyArray<string>): ReadonlySet<string> {
		const found = new Set<string>()
		const pending = [...tests]

		for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
			const next = named_from(current).filter((file) => !found.has(file))

			for (const file of next) found.add(file)
			pending.push(...next)
		}

		return found
	}

	return { started, related: reverse_of(graph, universe, names_of) }
}

const test_pinned_spawn = { create }

export type { TestSpawn }
export { test_pinned_spawn }
