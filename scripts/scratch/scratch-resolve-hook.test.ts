import { spawnSync } from 'node:child_process'
import { realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'

// The hook registers itself on import, so it is exercised in a child Node that preloads it, as
// `scratch:run` does — importing it here would change resolution for the whole test worker.
const HOOK_URL = new URL('scratch-resolve-hook.ts', import.meta.url).href
const SCRIPTS_MODULE = fileURLToPath(new URL('../run/board/run-board-screen', import.meta.url))
const SPAWN_TIMEOUT_MS = 30_000
const make_directory = temporary_directory('suite')

function run_with_hook(source: string): number | null {
	const directory = realpathSync(make_directory('scratch-resolve-hook-'))
	const script = path.join(directory, 'probe.ts')

	writeFileSync(script, source)

	return spawnSync(process.execPath, ['--import', HOOK_URL, script], {
		cwd: directory,
		encoding: 'utf8',
		env: { ...process.env, NODE_OPTIONS: undefined },
	}).status
}

describe('scratch resolve hook', () => {
	it('adds .ts to an extensionless path import', { timeout: SPAWN_TIMEOUT_MS }, () => {
		expect(run_with_hook(`import '${SCRIPTS_MODULE}'\n`)).toBe(0)
	})

	it('leaves an import that names its .ts alone', { timeout: SPAWN_TIMEOUT_MS }, () => {
		expect(run_with_hook(`import '${SCRIPTS_MODULE}.ts'\n`)).toBe(0)
	})

	it('still fails on a path that does not exist', { timeout: SPAWN_TIMEOUT_MS }, () => {
		expect(run_with_hook(`import '${SCRIPTS_MODULE}-missing'\n`)).toBe(1)
	})

	it('does not retry a bare package name', { timeout: SPAWN_TIMEOUT_MS }, () => {
		expect(run_with_hook("import 'no-such-package-8733'\n")).toBe(1)
	})
})
