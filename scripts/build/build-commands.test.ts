import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { josh_in_process } from '#scripts/josh/josh-in-process'
import { josh_logic } from '#scripts/josh/josh-logic'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeAll, describe, expect, it } from 'vitest'
import { build_commands, bundled_scripts } from './build-commands'
import { COMMANDS_TEST_PREFIX } from './distribution-scratch-fixture'
import { hook_bundle_stamp } from './hook-bundle-stamp'
import { SCRIPTS_DIR } from './import-closure-fixture'

const BUILD_TIMEOUT = 60_000
const PACKAGE_DIR = path.join(SCRIPTS_DIR, '..')
const DIST_DIR = path.join(PACKAGE_DIR, 'dist')
const DOC_SECTION_SCRIPT = 'scripts/document/document-section-main.ts'
const SECTION_ARGUMENTS = ['CLAUDE.md', 'Communication']
const SECTION_HEADING = '## Communication'
const CHUNK_PREFIX = 'chunk-'

// A private directory at the same depth as `dist/commands`, so a module that finds the package from
// its own `import.meta.url` resolves the same root, and a `pnpm build` running beside this suite never
// empties the directory under it.
mkdirSync(DIST_DIR, { recursive: true })
const out_directory = temporary_directory('suite')(path.join(DIST_DIR, COMMANDS_TEST_PREFIX))

beforeAll(async () => {
	await build_commands(out_directory)
}, BUILD_TIMEOUT)

function bundle_of(script: string): string {
	const name = path.basename(josh_in_process.bundled_script_path(PACKAGE_DIR, script))

	return path.join(out_directory, name)
}

// Launched the way `dist/josh.js` launches it (`josh-in-process.ts`): `argv[1]` names the source
// script, whose location the bundle keeps, and the bundle itself is imported.
const DISPATCH_LIKE = 'await import(process.argv.splice(2, 1)[0])'

function run_node(
	script: string,
	arguments_: ReadonlyArray<string>,
): { status: number | null; stdout: string } {
	const launch = [path.join(PACKAGE_DIR, script), pathToFileURL(bundle_of(script)).href]

	return spawnSync('node', ['--input-type=module', '-e', DISPATCH_LIKE, ...launch, ...arguments_], {
		cwd: PACKAGE_DIR,
		encoding: 'utf8',
	})
}

describe('build_commands — the pre-built doc:section', () => {
	it('records command sources for the shared freshness check', () => {
		expect(hook_bundle_stamp.is_fresh(out_directory, PACKAGE_DIR)).toBe(true)
	})
	it('bundles doc:section', () => {
		expect(bundled_scripts()).toContain(DOC_SECTION_SCRIPT)
	})

	it('prints the section under plain node, with no TypeScript loader', () => {
		const result = run_node(DOC_SECTION_SCRIPT, SECTION_ARGUMENTS)

		expect(result.status).toBe(0)
		expect(result.stdout.startsWith(SECTION_HEADING)).toBe(true)
	})
})

const COMMAND_SCRIPTS = Object.values(COMMAND_MAP).flatMap((entry) => entry.script ?? [])

describe('every script command is pre-built', () => {
	it('prints completion names under plain node without a TypeScript loader', () => {
		const result = run_node('scripts/josh/josh-completion.ts', ['--names'])

		expect(result.status).toBe(0)
		expect(result.stdout).toBe(`${josh_logic.all_command_names().join('\n')}\n`)
	})

	it('bundles the script of every command in the map', () => {
		expect(new Set(bundled_scripts())).toStrictEqual(new Set(COMMAND_SCRIPTS))
	})

	it('names each bundle once, so no two commands write the same output file', () => {
		const outputs = bundled_scripts().map((script) =>
			josh_in_process.bundled_script_path(PACKAGE_DIR, script),
		)

		expect(new Set(outputs).size).toBe(outputs.length)
	})

	it('moves the code the commands share into chunks beside them', () => {
		const chunks = readdirSync(out_directory).filter((name) => name.startsWith(CHUNK_PREFIX))

		expect(chunks.length).toBeGreaterThan(0)
	})
})
