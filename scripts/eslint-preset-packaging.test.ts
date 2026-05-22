import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ESLINT_DIR = path.join(PACKAGE_ROOT, 'eslint')

interface PackageJson {
	dependencies?: Record<string, string>
	// eslint-disable-next-line @typescript-eslint/naming-convention -- package.json field name is fixed by npm
	peerDependencies?: Record<string, string>
}

const PACKAGE_JSON = JSON.parse(
	readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
) as PackageJson

const TEST_SUFFIXES = ['.test.ts', '.spec.ts'] as const
const RULE_FILE_EXTENSIONS = ['.js', '.ts'] as const
const FROM_CLAUSE_REGEX = /\bfrom\s+['"]([^'"]+)['"]/u
const IMPORT_LINE_PREFIX = 'import'

function is_test_file(file_name: string): boolean {
	return TEST_SUFFIXES.some((suffix) => file_name.endsWith(suffix))
}

function walk(directory: string, accumulator: Array<string>): void {
	for (const entry of readdirSync(directory)) {
		const full_path = path.join(directory, entry)
		const stats = statSync(full_path)

		if (stats.isDirectory()) {
			walk(full_path, accumulator)
		} else {
			accumulator.push(full_path)
		}
	}
}

function list_eslint_files(): Array<string> {
	const files: Array<string> = []

	walk(ESLINT_DIR, files)

	return files
}

function is_external_package(specifier: string): boolean {
	return !specifier.startsWith('.') && !specifier.startsWith('node:')
}

function package_name_from_specifier(specifier: string): string {
	const segments = specifier.split('/')
	if (specifier.startsWith('@')) return segments.slice(0, 2).join('/')

	return segments[0] ?? specifier
}

function consumer_runtime_files(): Array<string> {
	return list_eslint_files().filter((file_path) => {
		const file_name = path.basename(file_path)
		if (is_test_file(file_name)) return false

		return RULE_FILE_EXTENSIONS.some((extension) => file_name.endsWith(extension))
	})
}

function specifier_from_import_line(line: string): string | undefined {
	const trimmed = line.trim()
	if (!trimmed.startsWith(IMPORT_LINE_PREFIX)) return undefined

	return FROM_CLAUSE_REGEX.exec(trimmed)?.[1]
}

function imported_packages(file_path: string): Array<string> {
	const packages = new Set<string>()

	for (const line of readFileSync(file_path, 'utf8').split('\n')) {
		const specifier = specifier_from_import_line(line)

		if (specifier !== undefined && is_external_package(specifier)) {
			packages.add(package_name_from_specifier(specifier))
		}
	}

	return [...packages]
}

function declared_runtime_packages(): Set<string> {
	return new Set([
		...Object.keys(PACKAGE_JSON.dependencies ?? {}),
		...Object.keys(PACKAGE_JSON.peerDependencies ?? {}),
	])
}

describe('eslint preset packaging — Bug 1 guard (runtime plugin imports)', () => {
	const declared = declared_runtime_packages()

	it.each(consumer_runtime_files())(
		'every external import in %s is declared in dependencies or peerDependencies',
		(file_path) => {
			const missing = imported_packages(file_path).filter(
				(name) => !declared.has(name) && name !== 'eslint',
			)

			expect(missing).toEqual([])
		},
	)
})

describe('eslint preset packaging — Bug 2 guard (no consumer-runtime TS source)', () => {
	it('eslint/ ships no .ts files outside *.test.ts / *.spec.ts', () => {
		const stray_ts = list_eslint_files().filter((file_path) => {
			const file_name = path.basename(file_path)

			return file_name.endsWith('.ts') && !is_test_file(file_name)
		})

		expect(stray_ts).toEqual([])
	})
})
