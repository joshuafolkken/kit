import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// #818: the port numbers used to be independent literals in `playwright.config.ts`, app-kit's DAST
// module and every consumer's `preview` scripts, so a project could not move off the defaults
// without editing all of them in lockstep and keeping them in agreement forever. `ports/index.js`
// is now the one definition in kit; a literal reappearing anywhere else is a second definition that
// would silently stop following `PORT_SEED`.
const PORTS_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(PORTS_DIR, '..')
const DEFINITION_FILE = path.join(PORTS_DIR, 'index.js')
const PORT_LITERALS: ReadonlyArray<string> = ['5173', '4173']

// Source trees that ship or run code. Tests state the expected numbers on purpose and prose
// documents them for the reader, so neither is a second definition.
const SCANNED_DIRECTORIES: ReadonlyArray<string> = ['ports', 'scripts', 'scripts-ai', 'eslint']
const SCANNED_ROOT_FILES: ReadonlyArray<string> = [
	'playwright.config.ts',
	'playwright-config-fixture.ts',
	'eslint.config.js',
]
const SOURCE_EXTENSIONS: ReadonlyArray<string> = ['.ts', '.js']

function is_source_file(relative_path: string): boolean {
	if (relative_path.endsWith('.test.ts') || relative_path.endsWith('.d.ts')) return false

	return SOURCE_EXTENSIONS.some((extension) => relative_path.endsWith(extension))
}

function files_in(directory: string): Array<string> {
	return readdirSync(path.join(REPO_ROOT, directory), { recursive: true })
		.map((entry) => entry.toString())
		.filter((entry) => is_source_file(entry))
		.map((entry) => path.join(REPO_ROOT, directory, entry))
}

function scanned_files(): Array<string> {
	const nested = SCANNED_DIRECTORIES.flatMap((directory) => files_in(directory))
	const root = SCANNED_ROOT_FILES.map((file) => path.join(REPO_ROOT, file))

	return [...nested, ...root].filter((file) => file !== DEFINITION_FILE)
}

function offenders(literal: string): Array<string> {
	return scanned_files()
		.filter((file) => readFileSync(file, 'utf8').includes(literal))
		.map((file) => path.relative(REPO_ROOT, file))
}

describe('port literals', () => {
	it('scans the source tree it claims to guard', () => {
		expect(scanned_files().length).toBeGreaterThan(0)
		expect(scanned_files()).not.toContain(DEFINITION_FILE)
	})

	it.each(PORT_LITERALS)('has no %s outside ports/index.js', (literal) => {
		expect(offenders(literal)).toStrictEqual([])
	})

	it('keeps both literals in the one definition file', () => {
		const definition = readFileSync(DEFINITION_FILE, 'utf8')

		for (const literal of PORT_LITERALS) expect(definition).toContain(literal)
	})
})
