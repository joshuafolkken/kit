import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { josh_in_process } from '#scripts/josh/josh-in-process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build_commands, bundled_scripts } from './build-commands'
import { import_closure, SCRIPTS_DIR } from './import-closure-fixture'

const BUILD_TIMEOUT = 60_000
const PACKAGE_DIR = path.join(SCRIPTS_DIR, '..')
const DIST_DIR = path.join(PACKAGE_DIR, 'dist')
const DOC_SECTION_SCRIPT = 'scripts/document/document-section-cli.ts'
const SECTION_ARGUMENTS = ['CLAUDE.md', 'Project']
const SECTION_HEADING = '## Project'
const MAIN_GUARD = 'process.argv[1]'

// A private directory at the same depth as `dist/commands`, so a module that finds the package from
// its own `import.meta.url` resolves the same root, and a `pnpm build` running beside this suite never
// empties the directory under it.
mkdirSync(DIST_DIR, { recursive: true })
const out_directory = mkdtempSync(path.join(DIST_DIR, '.commands-test-'))

beforeAll(async () => {
	await build_commands(out_directory)
}, BUILD_TIMEOUT)

afterAll(() => {
	rmSync(out_directory, { recursive: true, force: true })
})

function bundle_of(script: string): string {
	const name = path.basename(josh_in_process.bundled_script_path(PACKAGE_DIR, script))

	return path.join(out_directory, name)
}

function run_node(
	file: string,
	arguments_: ReadonlyArray<string>,
): { status: number | null; stdout: string } {
	return spawnSync('node', [file, ...arguments_], { cwd: PACKAGE_DIR, encoding: 'utf8' })
}

describe('build_commands — the pre-built doc:section', () => {
	it('bundles doc:section as the first command that skips the tsx child', () => {
		expect(bundled_scripts()).toContain(DOC_SECTION_SCRIPT)
	})

	it('prints the section under plain node, with no TypeScript loader', () => {
		const result = run_node(bundle_of(DOC_SECTION_SCRIPT), SECTION_ARGUMENTS)

		expect(result.status).toBe(0)
		expect(result.stdout.startsWith(SECTION_HEADING)).toBe(true)
	})
})

const BUNDLED_ENTRIES = Object.entries(COMMAND_MAP).filter(([, entry]) => entry.is_bundled === true)

describe('every is_bundled command can be bundled safely', () => {
	// A single-file bundle gives every module the entry's `import.meta.url`, so a second main guard in
	// the closure would run its own main beside the command's.
	it.each(bundled_scripts())('%s carries no other main guard in its import closure', (script) => {
		const entry = path.join(PACKAGE_DIR, script)
		const others = [...import_closure.closure([entry])].filter((file) => file !== entry)
		const guarded = others.filter((file) => readFileSync(file, 'utf8').includes(MAIN_GUARD))

		expect(guarded).toStrictEqual([])
	})

	// `--env-file` has to be in force before the first line, which an in-process import cannot give.
	it.each(BUNDLED_ENTRIES)('%s carries no tsx_arguments', (_name, entry) => {
		expect(entry.tsx_arguments).toBeUndefined()
	})

	it('names each bundle once, so no two commands write the same output file', () => {
		const outputs = bundled_scripts().map((script) =>
			josh_in_process.bundled_script_path(PACKAGE_DIR, script),
		)

		expect(new Set(outputs).size).toBe(outputs.length)
	})
})
