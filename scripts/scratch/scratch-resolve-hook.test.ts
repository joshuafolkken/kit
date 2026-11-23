import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { copyFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'

// The hook registers itself on import, so it is exercised in a child Node that preloads it, as
// `scratch:run` does — importing it here would change resolution for the whole test worker.
const HOOK_URL = new URL('scratch-resolve-hook.mjs', import.meta.url).href
const SCRIPTS_MODULE = fileURLToPath(new URL('../run/board/run-board-screen', import.meta.url))
const SPAWN_TIMEOUT_MS = 30_000
const MODULE_NOT_FOUND = 'ERR_MODULE_NOT_FOUND'
const make_directory = temporary_directory('suite')

function spawn_with_hook(source: string, hook_url = HOOK_URL): SpawnSyncReturns<string> {
	const directory = realpathSync(make_directory('scratch-resolve-hook-'))
	const script = path.join(directory, 'probe.ts')

	writeFileSync(script, source)

	return spawnSync(process.execPath, ['--import', hook_url, script], {
		cwd: directory,
		encoding: 'utf8',
		env: { ...process.env, NODE_OPTIONS: undefined },
	})
}

function run_with_hook(source: string, hook_url = HOOK_URL): number | null {
	return spawn_with_hook(source, hook_url).status
}

describe('scratch resolve hook', () => {
	it('adds .ts to an extensionless path import', { timeout: SPAWN_TIMEOUT_MS }, () => {
		expect(run_with_hook(`import '${SCRIPTS_MODULE}'\n`)).toBe(0)
	})

	it('leaves an import that names its .ts alone', { timeout: SPAWN_TIMEOUT_MS }, () => {
		expect(run_with_hook(`import '${SCRIPTS_MODULE}.ts'\n`)).toBe(0)
	})

	it('does not add a second .ts to a missing .ts import', { timeout: SPAWN_TIMEOUT_MS }, () => {
		const { status, stderr } = spawn_with_hook(`import '${SCRIPTS_MODULE}-missing.ts'\n`)

		expect(status).toBe(1)
		expect(stderr).toContain(MODULE_NOT_FOUND)
		expect(stderr).not.toContain('-missing.ts.ts')
	})

	it('still fails on a path that does not exist', { timeout: SPAWN_TIMEOUT_MS }, () => {
		expect(run_with_hook(`import '${SCRIPTS_MODULE}-missing'\n`)).toBe(1)
	})

	it('rethrows a bare package miss as it is', { timeout: SPAWN_TIMEOUT_MS }, () => {
		const { status, stderr } = spawn_with_hook("import 'no-such-package-8733'\n")

		expect(status).toBe(1)
		expect(stderr).toContain(MODULE_NOT_FOUND)
		expect(stderr).toContain("'no-such-package-8733'")
	})

	// A consumer's copy sits under `node_modules`, where Node refuses to strip a `.ts` hook's types.
	it('loads from a node_modules install', { timeout: SPAWN_TIMEOUT_MS }, () => {
		const installed = path.join(make_directory('scratch-hook-install-'), 'node_modules', 'kit')

		mkdirSync(installed, { recursive: true })
		copyFileSync(fileURLToPath(HOOK_URL), path.join(installed, 'hook.mjs'))

		const hook_url = pathToFileURL(path.join(installed, 'hook.mjs')).href

		expect(run_with_hook(`import '${SCRIPTS_MODULE}'\n`, hook_url)).toBe(0)
	})
})
