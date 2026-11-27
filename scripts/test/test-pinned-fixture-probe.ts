import { existsSync } from 'node:fs'
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { BaseTree } from '#scripts/git/base-tree'
import { afterAll, beforeAll, expect } from 'vitest'
import { test_red } from './test-red'
import { test_red_logic, type RedProbe } from './test-red-logic'

// joshuafolkken/kit#9117: `test_red.probe_in` in-process for the `test-pinned-*` fixture trees. Each
// probe copies its tree to a fresh directory — fresh module URLs, so a revert is never read from the
// module cache — and imports the selected test files there against the tree's own (reverted) code,
// with their `vitest` import read off this runner. A failed case or a file that cannot load is red,
// as a vitest child would read it. Only `it` and `expect` are served: a fixture that mocks a module
// keeps the real probe. `test-pinned-fixture-probe.test.ts` holds it to the real probe's verdicts.

type Case = () => unknown
type Registry = Map<string, Array<Case>>

const REGISTRY_KEY = 'josh_pinned_probe'
const SKIPPED = new Set(['node_modules', '.git'])
const TEST_PATTERN = /\.test\.[jt]s$/u
const IMPORT_PATTERN = /(?:from|import)\s+'(\.[^']+)'/gu
const VITEST_IMPORT = /^import \{([^}]*)\} from 'vitest'$/mu
const EXTENSIONS = ['', '.ts', '.js']
const EXCLUDE_FLAG = '--exclude'
const RELATED = 'related'
const probe_count = { value: 0 }
const saved: { real?: typeof test_red.probe_in } = {}

declare global {
	var josh_pinned_probe: Registry | undefined
}

// The rewritten fixture tests read their `vitest` names off this global, the one place both see.
function registry(): Registry {
	const found = globalThis.josh_pinned_probe ?? new Map<string, Array<Case>>()

	Object.defineProperty(globalThis, REGISTRY_KEY, { value: found, configurable: true })

	return found
}

// The files a selection names, apart from its flags and each `--exclude` value.
function named_files(selection: ReadonlyArray<string>): Array<string> {
	return selection
		.slice(1)
		.filter((value, index, all) => !value.startsWith('-') && all[index - 1] !== EXCLUDE_FLAG)
}

function resolved(from: string, specifier: string): string | undefined {
	const base = path.join(path.dirname(from), specifier)

	return EXTENSIONS.map((extension) => `${base}${extension}`).find((file) => existsSync(file))
}

async function imports_of(file: string): Promise<Array<string>> {
	const source = await readFile(file, 'utf8')
	const specifiers = [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1] ?? '')

	return specifiers.flatMap((specifier) => resolved(file, specifier) ?? [])
}

async function closure_of(file: string, seen = new Set<string>()): Promise<Set<string>> {
	if (seen.has(file)) return seen
	seen.add(file)
	const imports = await imports_of(file)

	await Promise.all(imports.map(async (next) => await closure_of(next, seen)))

	return seen
}

async function reaches(test: string, targets: ReadonlyArray<string>): Promise<boolean> {
	const closure = await closure_of(test)

	return targets.some((target) => closure.has(target))
}

async function tests_in(root: string): Promise<Array<string>> {
	const entries = await readdir(root, { recursive: true })

	return entries
		.filter((entry) => TEST_PATTERN.test(entry))
		.toSorted((left, right) => left.localeCompare(right))
}

// `run <tests>` runs the tests named; `related <files>` every test whose import closure holds one.
async function selected(root: string, selection: ReadonlyArray<string>): Promise<Array<string>> {
	const files = named_files(selection)
	const absolute = files.map((file) => path.join(root, file))

	if (selection[0] !== RELATED) return files.filter((file) => existsSync(path.join(root, file)))
	const tests = await tests_in(root)
	const reaching = await Promise.all(
		tests.map(async (test) => await reaches(path.join(root, test), absolute)),
	)

	return tests.filter((_, index) => reaching[index] === true)
}

function collect(cases: Array<Case>): (title: string, body: Case) => void {
	return function it(_title: string, body: Case): void {
		cases.push(body)
	}
}

// The file's `it` cases, with its `vitest` import rewritten to read this probe's registry entry.
async function cases_of(file: string, key: string): Promise<Array<Case>> {
	const source = await readFile(file, 'utf8')
	const cases: Array<Case> = []

	await writeFile(
		file,
		source.replace(
			VITEST_IMPORT,
			(_line, names: string) => `const {${names}} = globalThis.${REGISTRY_KEY}.get('${key}').serve`,
		),
	)
	registry().set(key, Object.assign(cases, { serve: { expect, it: collect(cases) } }))
	await import(/* @vite-ignore */ file)

	return cases
}

// One case after another, as vitest runs a file's cases; the first to throw stops the file.
async function run_in_order(cases: ReadonlyArray<Case>, index = 0): Promise<void> {
	const body = cases[index]

	if (body === undefined) return
	await body()
	await run_in_order(cases, index + 1)
}

async function is_passing(file: string, key: string): Promise<boolean> {
	try {
		await run_in_order(await cases_of(file, key))

		return true
	} catch {
		return false
	} finally {
		registry().delete(key)
	}
}

function next_key(): string {
	probe_count.value += 1

	return String(probe_count.value)
}

async function copy_tree(tree: string): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), 'josh-pinned-probe-'))

	await cp(tree, root, {
		recursive: true,
		filter: (source) => !SKIPPED.has(path.basename(source)),
	})

	return root
}

async function probe_in(base: BaseTree, selection: ReadonlyArray<string>): Promise<RedProbe> {
	const root = await copy_tree(base.tree)

	try {
		const tests = await selected(root, selection)
		const passing = await Promise.all(
			tests.map(async (test) => await is_passing(path.join(root, test), next_key())),
		)
		const failed = tests.filter((_, index) => passing[index] === false)

		return {
			verdict: test_red_logic.verdict_for(tests.length, failed.length > 0),
			failed,
			ran: tests.length,
		}
	} finally {
		await rm(root, { recursive: true, force: true })
	}
}

function install(): void {
	saved.real = test_red.probe_in
	test_red.probe_in = probe_in
}

function restore(): void {
	if (saved.real !== undefined) test_red.probe_in = saved.real
}

// Serves `test_red.probe_in` in-process for the tests of the enclosing file or `describe`, so a spy a
// test sets on it wraps this probe rather than a vitest child.
function use_in_process(): void {
	beforeAll(install)
	afterAll(restore)
}

const test_pinned_fixture_probe = { probe_in, use_in_process }

export { test_pinned_fixture_probe }
