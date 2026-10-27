import path from 'node:path'
import type { ImportGraph } from '#scripts/lint/import-graph'
import { describe, expect, it } from 'vitest'
import { test_pinned_spawn } from './test-pinned-spawn'

// joshuafolkken/kit#5261: the files a failed test can start past its imports, read off the file names
// in the strings of what it runs.

const ROOT = path.resolve('project')
const TEST = 'driver.test.ts'
const HELPER = 'helper.ts'
const CLI = 'cli.ts'
const COMMAND = 'command-main.ts'
const UNNAMED = 'unnamed-cli.ts'
const OTHER_TEST = 'other.test.ts'

function at(name: string): string {
	return path.join(ROOT, name)
}

// A graph whose only import is the test's of `helper.ts`, each file holding the given strings.
function graph_of(strings: Record<string, ReadonlyArray<string>>): ImportGraph {
	return {
		closure: (file) => (file === at(TEST) ? [at(HELPER)] : []),
		closure_hash: () => '',
		imports: () => [],
		importers: () => new Set(),
		strings: (file) => strings[path.basename(file)] ?? [],
	}
}

function started_in(strings: Record<string, ReadonlyArray<string>>): Array<string> {
	const universe = [TEST, HELPER, CLI, COMMAND, UNNAMED, OTHER_TEST].map((name) => at(name))
	const spawn = test_pinned_spawn.create(graph_of(strings), universe)
	const started = [...spawn.started([at(TEST)])].map((file) => path.basename(file))

	return started.toSorted((left, right) => left.localeCompare(right))
}

describe('test_pinned_spawn.started', () => {
	it('names the files the test, a module it imports and a file it starts name in turn', () => {
		const started = started_in({
			[HELPER]: [`scripts/${CLI}`],
			[CLI]: [COMMAND],
		})

		expect(started).toEqual([CLI, COMMAND])
	})

	it('names no test file, and nothing where no string names a file', () => {
		expect(started_in({ [TEST]: [OTHER_TEST, 'driver'] })).toEqual([])
	})
})
