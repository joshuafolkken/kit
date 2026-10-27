import path from 'node:path'
import type { ImportGraph } from '#scripts/lint/import-graph'
import { test_declared_logic } from './test-declared-logic'

// The code a failed test can run past its import closure (joshuafolkken/kit#5261): a test starts a CLI
// by naming its file in a string, so a file a string literal of the test or of a module it imports
// names is one it may start, and so is a file the strings that one runs name in turn — the command a
// spawned dispatcher starts by its path. Only these, with their closures, are what a `josh
// test:pinned` red rests on besides the test's own closure; an edit to code nothing named reaches
// leaves the red held. A comment starts nothing, so its file names are not read.
//
// A name is a file's base name, so a file named by another with the same base name counts too: the
// match errs toward re-probing, never toward holding a red its test no longer pins.

const TOKEN = /[\w.-]+/gu

interface TestSpawn {
	started: (tests: ReadonlyArray<string>) => ReadonlySet<string>
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

function create(graph: ImportGraph, universe: ReadonlyArray<string>): TestSpawn {
	const index = index_of(universe)
	const named_by = new Map<string, ReadonlyArray<string>>()

	function names_of(file: string): ReadonlyArray<string> {
		const known = named_by.get(file)
		if (known !== undefined) return known
		const names = names_in(graph.strings(file).join(' '), index)

		named_by.set(file, names)

		return names
	}

	// What `file` runs names: its own text and that of every module its imports reach.
	function named_from(file: string): Array<string> {
		return [file, ...graph.closure(file)].flatMap((read) => names_of(read))
	}

	function started(tests: ReadonlyArray<string>): ReadonlySet<string> {
		const found = new Set<string>()
		const pending = [...tests]

		for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
			const next = [...new Set(named_from(current))].filter((file) => !found.has(file))

			for (const file of next) found.add(file)
			pending.push(...next)
		}

		return found
	}

	return { started }
}

const test_pinned_spawn = { create }

export type { TestSpawn }
export { test_pinned_spawn }
