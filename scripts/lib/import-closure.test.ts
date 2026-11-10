import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { import_closure, SCRIPTS_DIR } from './import-closure'

const make_directory = temporary_directory('suite')
const PREFIX = 'import-closure-'

// Each file of `sources` written under a fresh directory, by name.
function written(sources: Readonly<Record<string, string>>): string {
	const directory = make_directory(PREFIX)

	for (const [name, source] of Object.entries(sources)) {
		writeFileSync(path.join(directory, `${name}.ts`), source)
	}

	return directory
}

describe('import_closure.imports_of — the scripts-local value imports of one file', () => {
	it('resolves relative and #scripts specifiers and drops packages and type-only imports', () => {
		const directory = written({
			entry: [
				"import { a } from './a'",
				"import type { B } from './b'",
				"import { c } from '#scripts/lib/c'",
				"import { z } from 'zod'",
			].join('\n'),
		})

		expect(import_closure.imports_of(path.join(directory, 'entry.ts'))).toStrictEqual([
			path.join(directory, 'a.ts'),
			path.join(SCRIPTS_DIR, 'lib', 'c.ts'),
		])
	})

	it('reads a missing file as importing nothing', () => {
		const gone = path.join(make_directory(PREFIX), 'gone.ts')

		expect(import_closure.imports_of(gone)).toStrictEqual([])
	})
})

describe('import_closure.closure — every file a seed reaches', () => {
	it('walks transitive and re-exported imports once each', () => {
		const directory = written({
			entry: "import { a } from './a'\nexport { b } from './b'",
			a: "import { b } from './b'",
			b: "import { entry } from './entry'",
		})
		const files = import_closure.closure([path.join(directory, 'entry.ts')])

		expect([...files]).toStrictEqual(
			['entry', 'a', 'b'].map((name) => path.join(directory, `${name}.ts`)),
		)
	})
})
