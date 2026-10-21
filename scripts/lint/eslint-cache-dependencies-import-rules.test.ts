import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { create_base_config } from '#eslint/base.js'
import { ESLint } from 'eslint'
import ts from 'typescript-eslint'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { eslint_cache_dependencies } from './eslint-cache-dependencies'

// joshuafolkken/kit#3641 / #3667 / #4420: an import rule's verdict is about a fact that lives in
// another file. Only the other file changes, so the cache's key — the linted file's own content — is
// what it was, and an unguarded run answers the old red. Every case lints a real fixture against a
// real cache file, because a mocked linter would have no stale entry to answer with.
const LINT_PROBE_TIMEOUT_MS = 60_000

vi.setConfig({ testTimeout: LINT_PROBE_TIMEOUT_MS })

const NO_CYCLE_RULE = 'import/no-cycle'
// The plugin's second name: its own preset's rules, which the base config keeps for a `.js` file.
const NAMED_RULE = 'import-x/named'
// Clean under every other rule of the base config, so the import rule is the only thing a run can
// report and a withdrawn report leaves a green one.
const CYCLIC_A = "import { BETA } from './b'\n\nexport const ALPHA = BETA + 1\n"
const ACYCLIC_A = 'export const ALPHA = 1\n'
const EDITED_SIDE = 'a.ts'
const UNTOUCHED_SIDE = 'b.ts'
const IMPORTER = 'importer.js'
const EXPORTER = 'exporter.js'
const WITHOUT_EXPORT = 'export const OTHER = 1\n'
const WITH_EXPORT = `${WITHOUT_EXPORT}\nexport const DELTA = 2\n`
const FIXTURE_FILES: Array<[string, string]> = [
	['package.json', JSON.stringify({ type: 'module' })],
	['tsconfig.json', JSON.stringify({ compilerOptions: { module: 'nodenext' } })],
	[EDITED_SIDE, CYCLIC_A],
	[UNTOUCHED_SIDE, "import { ALPHA } from './a'\n\nexport const BETA = ALPHA + 1\n"],
	[IMPORTER, "import { DELTA } from './exporter.js'\n\nexport const EPSILON = DELTA + 1\n"],
	[EXPORTER, WITHOUT_EXPORT],
]

// `realpathSync`: macOS hands back `/var/…`, a symlink to `/private/var/…`, and the resolver
// answers with the real path — the two have to agree for a cycle to close.
const created_root = mkdtempSync(path.join(tmpdir(), 'kit-eslint-cache-import-rules-'))
const root = realpathSync(created_root)
const cache_file = path.join(root, '.eslintcache')

for (const [name, source] of FIXTURE_FILES) {
	writeFileSync(path.join(root, name), source)
}

// The import rules read the import graph, not types, so the typed parser is switched off rather than
// handed a tsconfig project to build for three-line files.
//
// `disallowAutomaticSingleRunInference`: under `CI=true` typescript-eslint takes the process for one
// CLI run, and a file parsed a second time in it gets a single-file fallback program — which a
// type-aware rule then reads, and `sonarjs/deprecation` throws on. These cases lint the same files
// over and over in one process, where a lint run parses each once.
function create_linter(): ESLint {
	return new ESLint({
		cwd: root,
		overrideConfigFile: true,
		overrideConfig: [
			...create_base_config({
				gitignore_path: new URL('../../.gitignore', import.meta.url),
				tsconfig_root_dir: root,
			}),
			ts.configs.disableTypeChecked,
			{ languageOptions: { parserOptions: { disallowAutomaticSingleRunInference: true } } },
		],
		cache: true,
		cacheStrategy: 'content',
		cacheLocation: cache_file,
	})
}

// The files the whole-tree lint reports under `rule`, run as the gate runs it: guarded, cached.
async function files_reported(rule: string): Promise<Array<string>> {
	const results = await eslint_cache_dependencies.guard(
		cache_file,
		async () => await create_linter().lintFiles(['.']),
		root,
	)

	return results
		.filter((result) => result.messages.some((message) => message.ruleId === rule))
		.map((result) => path.basename(result.filePath))
}

afterAll(() => {
	rmSync(root, { recursive: true, force: true })
})

describe('eslint_cache_dependencies.guard — a cycle closed by editing one side', () => {
	it('reports the cycle on both sides while it is there, and again from the cache', async () => {
		await expect(files_reported(NO_CYCLE_RULE)).resolves.toEqual([EDITED_SIDE, UNTOUCHED_SIDE])
		await expect(files_reported(NO_CYCLE_RULE)).resolves.toEqual([EDITED_SIDE, UNTOUCHED_SIDE])
	})

	it('drops the report the cache held for the untouched side', async () => {
		writeFileSync(path.join(root, EDITED_SIDE), ACYCLIC_A)

		await expect(files_reported(NO_CYCLE_RULE)).resolves.toEqual([])
	})
})

describe('eslint_cache_dependencies.guard — a name the imported file did not export yet', () => {
	it('reports it while the export is missing', async () => {
		await expect(files_reported(NAMED_RULE)).resolves.toEqual([IMPORTER])
	})

	it('drops the report the cache held for the importer once the export is added', async () => {
		writeFileSync(path.join(root, EXPORTER), WITH_EXPORT)

		await expect(files_reported(NAMED_RULE)).resolves.toEqual([])
	})
})
