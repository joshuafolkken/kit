import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { import_closure, SCRIPTS_DIR, TOOLS_DIR } from './import-closure-fixture'

// A module another module imports carries no main guard: the guard lives in an entry nothing imports
// (`*-cli.ts` / `*-main.ts`). A bundle is one file, so a guard inside an entry's import closure would
// fire with the entry's own `import.meta.url` and run a second main (joshuafolkken/kit#4186). Pinning
// it for every module, not only the `is_bundled` closures, keeps any command bundleable.
const TEST_SUFFIX = '.test.ts'

function source_files(directory: string): Array<string> {
	return readdirSync(directory, { withFileTypes: true, recursive: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
		.map((entry) => path.join(entry.parentPath, entry.name))
		.filter((file) => !file.endsWith(TEST_SUFFIX))
}

// Imported by a source file; an import from a test does not reach any bundle. A specifier that
// resolves to no `.ts` file (a directory, a `.js` asset) carries no guard.
function imported_modules(): Set<string> {
	const sources = [...source_files(SCRIPTS_DIR), ...source_files(TOOLS_DIR)]
	const imported = sources.flatMap((file) => import_closure.imports_of(file))

	return new Set(imported.filter((file) => existsSync(file)))
}

describe('main guard boundary', () => {
	it('leaves every imported module without a main guard of its own', () => {
		const guarded = [...imported_modules()]
			.filter((file) => import_closure.has_main_guard(file))
			.map((file) => path.relative(SCRIPTS_DIR, file))

		expect(guarded).toStrictEqual([])
	})
})
