import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type ts from 'typescript'

// One file of a fixture project: its project-relative path and the source written there.
type FixtureFile = readonly [relative: string, source: string]

const TMP_PREFIX = 'unused-members-'
// One ES lib rather than TypeScript's default set: the default pulls in DOM, about 83 lib files to
// parse and bind for every Program a case builds, and no fixture reads any of it.
const LIB = 'es2022'
const TSCONFIG = {
	compilerOptions: {
		target: 'ES2022',
		lib: [LIB],
		module: 'ESNext',
		moduleResolution: 'Bundler',
		strict: true,
		noEmit: true,
		types: [],
	},
	include: ['**/*.ts'],
	// A root config file outside the program, as kit's own `vitest.config.ts` is.
	exclude: ['*.config.ts'],
}

// A throwaway TypeScript project the detector reads over its own `tsconfig.json`.
function create_project(files: ReadonlyArray<FixtureFile>): string {
	const root = mkdtempSync(path.join(tmpdir(), TMP_PREFIX))

	writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify(TSCONFIG))

	for (const [relative, source] of files) {
		const file = path.join(root, relative)

		mkdirSync(path.dirname(file), { recursive: true })
		writeFileSync(file, source)
	}

	return root
}

// The namespace every case reads from: `kept` is always read, `dropped` only when the case reads it.
const LIBRARY = [
	'function kept(): number { return 1 }',
	'function dropped(): number { return 2 }',
	'const library = { kept, dropped }',
	'export { library }',
].join('\n')
const LIBRARY_FILE: FixtureFile = ['library.ts', LIBRARY]
const IMPORT_LIBRARY = "import { library } from './library'\n"
const READ_KEPT = 'export const value = library.kept()'

// The library beside a file that imports it and runs `reader`.
function with_reader(reader: string, relative = 'reader.ts'): Array<FixtureFile> {
	return [LIBRARY_FILE, [relative, `${IMPORT_LIBRARY}${reader}`]]
}

// The same options for a suite that builds its Program directly rather than from `tsconfig.json`.
const PROGRAM_OPTIONS: ts.CompilerOptions = {
	strict: true,
	noEmit: true,
	types: [],
	lib: [`lib.${LIB}.d.ts`],
}

const unused_members_fixture = { create_project, with_reader, LIBRARY, PROGRAM_OPTIONS, READ_KEPT }

export type { FixtureFile }
export { unused_members_fixture }
