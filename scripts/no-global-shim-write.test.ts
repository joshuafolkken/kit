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
// No kit script legitimately resolves the user's home directory, so this stays a clean tripwire.
const FORBIDDEN_SOURCE_MARKERS: ReadonlyArray<string> = ['.local/bin', 'homedir']

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

			return FORBIDDEN_SOURCE_MARKERS.some((marker) => content.includes(marker))
		})

		expect(offenders).toStrictEqual([])
	})

	it('declares no lifecycle hook that reinstalls a global shim', () => {
		const scripts = read_package_scripts()
		const offenders = LIFECYCLE_HOOKS.filter((hook) => scripts[hook]?.includes(INSTALL_BIN_MARKER))

		expect(offenders).toStrictEqual([])
	})
})
