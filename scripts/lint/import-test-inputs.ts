import { file_reader } from '#scripts/lib/read-file'
import { test_inputs } from '#scripts/test/test-inputs'
import type ts from 'typescript'
import { type_only_imports } from './type-only-imports'

type Resolve = (specifier: string, file: string) => { file: string; external: boolean } | undefined

const DECLARATION_EXTENSION = /\.d\.[cm]?ts$/u
const TYPESCRIPT_EXTENSION = /\.[cm]?tsx?$/u
const JAVASCRIPT_EXTENSIONS = ['js', 'jsx', 'mjs', 'cjs']

// TypeScript can resolve a declaration or prefer TS over an existing JS sibling, while the runner
// executes JS. Without a runtime resolution proof these inputs must be run again.
function is_runtime_source(typescript: typeof ts, file: string): boolean {
	if (DECLARATION_EXTENSION.test(file)) return false
	if (!TYPESCRIPT_EXTENSION.test(file)) return true

	return JAVASCRIPT_EXTENSIONS.every(
		(extension) =>
			!typescript.sys.fileExists(file.replace(TYPESCRIPT_EXTENSION, () => `.${extension}`)),
	)
}

function dependencies_of(
	typescript: typeof ts,
	resolve: Resolve,
	file: string,
	content: string,
): ReadonlyArray<string> | undefined {
	const specifiers = type_only_imports.runtime_specifiers(typescript, file, content)
	// Package imports and aliases may pick a different runtime condition than the type checker.
	const dependencies = specifiers
		.filter((name) => name !== 'vitest')
		.map((name) => (name.startsWith('.') ? resolve(name, file) : undefined))

	if (dependencies.some((dependency) => dependency === undefined || dependency.external)) {
		return undefined
	}

	return dependencies.flatMap((dependency) => dependency?.file ?? [])
}

function read_source(
	typescript: typeof ts,
	resolve: Resolve,
	file: string,
): ReadonlyArray<string> | undefined {
	if (!is_runtime_source(typescript, file)) return undefined
	const content = file_reader.read_if_readable(file)
	if (content === undefined || !test_inputs.is_closed(typescript, file, content)) return undefined

	return dependencies_of(typescript, resolve, file, content)
}

function unvisited(
	file: string,
	reached: ReadonlySet<string>,
	read: (file: string) => ReadonlyArray<string> | undefined,
): ReadonlyArray<string> | undefined {
	return reached.has(file) ? [] : read(file)
}

function closure(
	file: string,
	read: (file: string) => ReadonlyArray<string> | undefined,
): ReadonlyArray<string> | undefined {
	const reached = new Set<string>()
	const pending = [file]

	for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
		const dependencies = unvisited(current, reached, read)
		if (dependencies === undefined) return undefined
		reached.add(current)
		pending.push(...dependencies)
	}

	return [...reached]
}

function create(
	typescript: typeof ts,
	resolve: Resolve,
): (file: string) => ReadonlyArray<string> | undefined {
	const cache = new Map<string, ReadonlyArray<string> | undefined>()

	function read(file: string): ReadonlyArray<string> | undefined {
		if (!cache.has(file)) cache.set(file, read_source(typescript, resolve, file))

		return cache.get(file)
	}

	return (file) => closure(file, read)
}

const import_test_inputs = { create }

export { import_test_inputs }
