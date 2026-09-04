import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'
import type { CommandEntry } from './josh-command-types'
import { FAILURE_EXIT_CODE, josh_in_process } from './josh-in-process'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const JOSH_DIR = path.join(PACKAGE_DIR, 'scripts', 'josh')
const FIXTURE_PATH = path.join(JOSH_DIR, 'josh-in-process-fixture.ts')
const MISSING_SCRIPT_PATH = path.join(JOSH_DIR, 'no-such-script.ts')

// The two runtimes the dispatcher is reached through: kit's own `pnpm josh`, which starts tsx on
// this TypeScript source, and a consumer's `josh` bin, which is the bundled `dist/josh.js`.
const TYPESCRIPT_DISPATCHER_URL = 'file:///repo/scripts/josh/josh-logic.ts'
const BUNDLED_DISPATCHER_URL = 'file:///repo/dist/josh.js'

const FIXTURE_EXIT_CODE = 3
const SCRIPT_ENTRY: CommandEntry = {
	script: 'scripts/lint-related.ts',
	description: 'Lint the changed files',
	category: 'Development',
}

const ORIGINAL_ARGV = process.argv
const ORIGINAL_EXIT_CODE = process.exitCode

afterEach(() => {
	process.argv = ORIGINAL_ARGV
	process.exitCode = ORIGINAL_EXIT_CODE
	vi.restoreAllMocks()
})

describe('josh_in_process.can_run_in_process', () => {
	it('accepts a script command when the dispatcher itself was loaded as TypeScript', () => {
		expect(josh_in_process.can_run_in_process(SCRIPT_ENTRY, TYPESCRIPT_DISPATCHER_URL)).toBe(true)
	})

	// A consumer runs the bundle under plain node, which cannot evaluate `scripts/*.ts` at all, so
	// that install has to keep spawning tsx exactly as it did.
	it('refuses a script command when the dispatcher is the bundled dist/josh.js', () => {
		expect(josh_in_process.can_run_in_process(SCRIPT_ENTRY, BUNDLED_DISPATCHER_URL)).toBe(false)
	})

	// `--env-file` is a node flag that has to be in force before the script's first line runs.
	it('refuses a command carrying tsx_arguments', () => {
		const entry: CommandEntry = { ...SCRIPT_ENTRY, tsx_arguments: ['--env-file=.env'] }

		expect(josh_in_process.can_run_in_process(entry, TYPESCRIPT_DISPATCHER_URL)).toBe(false)
	})

	it('refuses a shell command, which has no script to import', () => {
		const entry: CommandEntry = {
			shell: ['pnpm', 'exec', 'prettier', '--check', '.'],
			description: 'Check formatting',
			category: 'Development',
		}

		expect(josh_in_process.can_run_in_process(entry, TYPESCRIPT_DISPATCHER_URL)).toBe(false)
	})
})

describe('josh_in_process.run_in_process', () => {
	it('runs the script in this process and answers with the exit code it set', async () => {
		const exit_code = await josh_in_process.run_in_process(FIXTURE_PATH, [
			String(FIXTURE_EXIT_CODE),
		])

		expect(exit_code).toBe(FIXTURE_EXIT_CODE)
		// The real path, because ESM resolution follows symlinks and the guard compares against it.
		expect(process.argv[1]).toBe(realpathSync(FIXTURE_PATH))
	})

	// A spawned tsx reported a broken script on stderr and exited 1; the in-process path may not
	// turn that into a silent success.
	it('answers 1 and reports the failure when the script cannot be loaded', async () => {
		vi.spyOn(console, 'error').mockImplementation(vi.fn())

		const exit_code = await josh_in_process.run_in_process(MISSING_SCRIPT_PATH, [])

		expect(exit_code).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error)).toHaveBeenCalled()
	})
})

const IN_PROCESS_SCRIPTS: ReadonlyArray<string> = Object.values(COMMAND_MAP)
	.filter((entry) => josh_in_process.can_run_in_process(entry, TYPESCRIPT_DISPATCHER_URL))
	.map((entry) => entry.script ?? '')

// The dispatcher sets `process.argv[1]` to the script's own path, so a script whose main guard is
// written any other way imports cleanly, does nothing, and answers 0 — a `josh gate` that passes
// without running a single check. Exactly two shapes are safe, and which one a script has is read
// off a list rather than off the absence of a substring: `process.argv.at(1)`, `import.meta.main`
// and `import.meta.filename` are all guards that a "contains no `process.argv[1]`" test would wave
// through as unconditional while they compare against the argv built here and can be false.
const CANONICAL_MAIN_GUARD = 'process.argv[1] === fileURLToPath(import.meta.url)'
const ENTRY_DETECTION_MARKERS: ReadonlyArray<string> = [
	'process.argv[1]',
	'process.argv.at(',
	'import.meta.main',
	'import.meta.filename',
]
const UNCONDITIONAL_SCRIPTS: ReadonlyArray<string> = [
	'scripts-ai/epic-check.ts',
	'scripts-ai/epic.ts',
	'scripts-ai/git-workflow.ts',
	'scripts/eval/eval-run.ts',
	'scripts/version/version-check.ts',
	'scripts/version/version-update.ts',
]
const GUARDED_SCRIPTS = IN_PROCESS_SCRIPTS.filter(
	(script) => !UNCONDITIONAL_SCRIPTS.includes(script),
)

function read_script(script: string): string {
	return readFileSync(path.join(PACKAGE_DIR, script), 'utf8')
}

// On a line of its own, not merely somewhere in the file: this very file quotes the guard in prose,
// and a script that documented it without executing it would otherwise pass while never running.
const LINE_COMMENT_PREFIX = '//'

function has_canonical_guard(source: string): boolean {
	return source
		.split('\n')
		.some(
			(line) =>
				!line.trimStart().startsWith(LINE_COMMENT_PREFIX) && line.includes(CANONICAL_MAIN_GUARD),
		)
}

describe('every command routed in-process still runs its own main', () => {
	it('routes more than one command in-process', () => {
		expect(IN_PROCESS_SCRIPTS.length).toBeGreaterThan(1)
	})

	// A stale entry here would silently exempt a script from the guard assertion below.
	it('names only scripts that are actually routed in-process as unconditional', () => {
		expect(IN_PROCESS_SCRIPTS).toEqual(expect.arrayContaining([...UNCONDITIONAL_SCRIPTS]))
	})

	it.each(GUARDED_SCRIPTS)('%s guards on the argv the dispatcher sets', (script) => {
		expect(has_canonical_guard(read_script(script))).toBe(true)
	})

	it.each(UNCONDITIONAL_SCRIPTS)('%s detects no entry point, so it always runs', (script) => {
		const source = read_script(script)

		for (const marker of ENTRY_DETECTION_MARKERS) expect(source).not.toContain(marker)
	})
})

// A module already in the registry is handed back without being evaluated again, so a command
// script that ever became reachable from the dispatcher's own static imports would import as a
// no-op: its main would never run and the command would answer 0 having done nothing.
// `josh-command-types.ts` records that `GATE_COMMAND` was moved out of `verification-gate.ts` to
// keep exactly that from happening, and until now nothing asserted it.
// Both spellings that put a module in the registry: `… from '…'`, which covers imports and
// re-exports alike, and a bare side-effect `import '…'` on a line of its own — missed, the walk
// would report a graph that is short of exactly the file this test is looking for.
const IMPORT_PATTERNS: ReadonlyArray<RegExp> = [
	/from[ \t]+'([^']+)'/gu,
	/^[ \t]*import[ \t]+'([^']+)'/gmu,
]
const SUBPATH_PREFIX = '#scripts/'
const TS_SUFFIX = '.ts'
const RELATIVE_PREFIX = '.'
// The dispatcher pulls in the whole command map and its helpers; a walk that resolved nothing would
// otherwise pass this suite by finding no file at all.
const MINIMUM_GRAPH_SIZE = 10

function resolve_import(specifier: string, from_file: string): string | undefined {
	if (specifier.startsWith(SUBPATH_PREFIX)) {
		const tail = specifier.slice(SUBPATH_PREFIX.length)

		return path.join(PACKAGE_DIR, 'scripts', `${tail}${TS_SUFFIX}`)
	}

	if (!specifier.startsWith(RELATIVE_PREFIX)) return undefined

	const resolved = path.resolve(path.dirname(from_file), specifier)

	return resolved.endsWith(TS_SUFFIX) ? resolved : `${resolved}${TS_SUFFIX}`
}

function resolve_matches(source: string, pattern: RegExp, file: string): Array<string> {
	const resolved: Array<string> = []

	for (const [, specifier] of source.matchAll(pattern)) {
		const target = resolve_import(specifier ?? '', file)

		if (target !== undefined && existsSync(target)) resolved.push(target)
	}

	return resolved
}

function read_imports(file: string): Array<string> {
	const source = readFileSync(file, 'utf8')

	return IMPORT_PATTERNS.flatMap((pattern) => resolve_matches(source, pattern, file))
}

function walk_imports(file: string, seen: Set<string>): void {
	if (seen.has(file)) return

	seen.add(file)
	for (const imported of read_imports(file)) walk_imports(imported, seen)
}

const DISPATCHER_GRAPH = new Set<string>()

walk_imports(path.join(JOSH_DIR, 'josh.ts'), DISPATCHER_GRAPH)

describe('no in-process command script is already in the dispatcher module registry', () => {
	it('walked a real import graph rather than an empty one', () => {
		expect(DISPATCHER_GRAPH.size).toBeGreaterThan(MINIMUM_GRAPH_SIZE)
	})

	it.each(IN_PROCESS_SCRIPTS)('%s is not imported by the dispatcher itself', (script) => {
		expect(DISPATCHER_GRAPH.has(path.join(PACKAGE_DIR, script))).toBe(false)
	})
})
