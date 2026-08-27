import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { with_scripts_schema } from '#scripts/schemas'
import { describe, expect, it } from 'vitest'

// Design principle (Issue #545 / #446): a per-project lifecycle hook must NEVER write to a shared,
// user-level PATH location. The pre-0.200.0 `install-bin.ts` shim (which wrote `~/.local/bin/josh`
// via `os.homedir()`) was removed and must not return — a single `pnpm install` in an old project
// would otherwise clobber the global `josh`. These guards fail if any such write path reappears.

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..')
const PACKAGE_JSON = path.join(REPO_ROOT, 'package.json')
const LIFECYCLE_HOOKS: ReadonlyArray<string> = ['prepare', 'postinstall', 'preinstall', 'install']
const INSTALL_BIN_MARKER = 'install-bin'
// Markers for any code path that could write to a shared, user-level location. `.local/bin` is the
// literal shim target; `homedir` is the escape hatch the removed shim used (`os.homedir()`), so
// forbidding it catches an equivalent reconstruction such as `path.join(os.homedir(), '.local', …)`.
const SHARED_PATH_MARKERS: ReadonlyArray<string> = ['.local/bin']
const FORBIDDEN_SOURCE_MARKERS: ReadonlyArray<string> = [...SHARED_PATH_MARKERS, 'homedir']

// The files allowed to resolve the home directory, named one by one. `josh cost` reads Claude
// Code's session transcripts, which live under `~/.claude/projects`, so resolving the home
// directory is unavoidable there — and reaching for `process.env.HOME` instead would be exactly the
// "equivalent reconstruction" the marker above exists to catch (joshuafolkken/kit#962).
//
// **The exemption is paid for, not granted.** The principle this guard protects is that no kit
// script *writes* to a shared, user-level location; an exempted file is therefore held to a
// stricter rule than the ban it escapes — it must contain no write call at all, which the second
// test below enforces. Adding a name here without that property defeats the guard.
const HOME_DIRECTORY_READERS: ReadonlyArray<string> = [path.join('cost', 'cost-transcript.ts')]
// Every way a Node script can put bytes on disk — sync, async and `fs/promises` alike — plus the
// low-level primitives the named calls are built on. Each entry is written so it can only match a
// call, never prose in a comment: a bare `rm` would match "confirm" and a bare `open` would match
// "opened", and a guard that fires on its own documentation gets deleted rather than fixed.
const WRITE_MARKERS: ReadonlyArray<string> = [
	'writeFile',
	'writeSync',
	'write(',
	'createWriteStream',
	'openSync',
	'open(',
	'mkdir',
	'rmSync',
	'rm(',
	'unlink',
	'rename',
	'copyFile',
	'cp(',
	'chmod',
	'symlink',
	'truncate',
	'appendFile',
]

// Matched against the path relative to `scripts/`, not by suffix: `endsWith` would also accept a
// file whose name merely ends with an allowed one.
function is_home_directory_reader(file: string): boolean {
	const relative = path.relative(SCRIPTS_DIR, file)

	return HOME_DIRECTORY_READERS.includes(relative)
}

function markers_for(file: string): ReadonlyArray<string> {
	return is_home_directory_reader(file) ? SHARED_PATH_MARKERS : FORBIDDEN_SOURCE_MARKERS
}

function all_source_files(): Array<string> {
	return readdirSync(SCRIPTS_DIR, { recursive: true })
		.map((entry) => entry.toString())
		.filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
		.map((entry) => path.join(SCRIPTS_DIR, entry))
}

function read_package_scripts(): Record<string, string> {
	const parsed = with_scripts_schema.parse(JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')))

	return parsed.scripts ?? {}
}

describe('no global shim write', () => {
	it('ships no install-bin script under scripts/', () => {
		const offenders = all_source_files().filter((file) =>
			path.basename(file).includes(INSTALL_BIN_MARKER),
		)

		expect(offenders).toStrictEqual([])
	})

	it('has no source file that references a shared global PATH location or the home directory', () => {
		const offenders = all_source_files().filter((file) => {
			const content = readFileSync(file, 'utf8')

			return markers_for(file).some((marker) => content.includes(marker))
		})

		expect(offenders).toStrictEqual([])
	})

	// The price of the exemption above: a file allowed to resolve the home directory may only read.
	it('lets no home-directory reader write anything', () => {
		const offenders = all_source_files()
			.filter((file) => is_home_directory_reader(file))
			.filter((file) => {
				const content = readFileSync(file, 'utf8')

				return WRITE_MARKERS.some((marker) => content.includes(marker))
			})

		expect(offenders).toStrictEqual([])
	})

	it('names only files that exist as home-directory readers', () => {
		const found = all_source_files().filter((file) => is_home_directory_reader(file))

		expect(found).toHaveLength(HOME_DIRECTORY_READERS.length)
	})

	it('declares no lifecycle hook that reinstalls a global shim', () => {
		const scripts = read_package_scripts()
		const offenders = LIFECYCLE_HOOKS.filter((hook) => scripts[hook]?.includes(INSTALL_BIN_MARKER))

		expect(offenders).toStrictEqual([])
	})
})
