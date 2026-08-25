import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, vi } from 'vitest'

// `sync` and `init` now refuse a self-run through the same helper, so their guard tests set up and
// assert the same run: nothing written, a non-zero exit code, and the refusal on stderr. The harness
// is shared for that reason — a second copy would be the clone the shared guard itself exists to
// prevent (joshuafolkken/kit#879).
interface GuardedRun {
	written: Array<string>
	message: string
}

type RunGuardedMain = (package_directory: string, project_root: string) => Promise<GuardedRun>

const PACKAGE_NAME = '@joshuafolkken/kit'
const REFUSAL_PREFIX = 'Refusing to sync'
const MANIFEST_NAME = 'package.json'

// Named rather than an inline `() => undefined`, which reads as a value the mock returns; the
// console output is simply discarded, and the spy is what the assertions read.
function discard_output(): void {
	// intentionally silent
}

function make_project(name: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'self-run-guard-'))

	writeFileSync(path.join(directory, MANIFEST_NAME), JSON.stringify({ name }))

	return directory
}

// The paths are read at import time by the command modules, so the caller mocks them and hands the
// import in: the whole point of the guard is what a `main()` does with the paths it was born with.
async function run_guarded_main(
	load_main: () => Promise<() => void>,
	project_root: string,
): Promise<GuardedRun> {
	const error_spy = vi.spyOn(console, 'error').mockImplementation(discard_output)

	vi.spyOn(console, 'info').mockImplementation(discard_output)

	const main = await load_main()

	main()

	return { written: readdirSync(project_root), message: error_spy.mock.calls.flat().join('\n') }
}

// Runs the command and asserts the half both entry points share — the project is untouched and the
// exit code is non-zero — then hands back the refusal so the caller can assert which branch fired.
async function expect_refusal(
	run: RunGuardedMain,
	package_directory: string,
	project_root: string,
): Promise<string> {
	const before = readdirSync(project_root)
	// The manifest is read as well as listed: `init` rewrites `package.json` scripts and
	// devDependencies in place, which leaves the directory listing identical (joshuafolkken/kit#879).
	const manifest_before = readFileSync(path.join(project_root, MANIFEST_NAME), 'utf8')
	const { written, message } = await run(package_directory, project_root)

	expect(written).toStrictEqual(before)
	expect(readFileSync(path.join(project_root, MANIFEST_NAME), 'utf8')).toBe(manifest_before)
	expect(process.exitCode).toBe(1)

	return message
}

const self_run_guard_fixture = {
	make_project,
	run_guarded_main,
	expect_refusal,
	PACKAGE_NAME,
	REFUSAL_PREFIX,
}

export { self_run_guard_fixture, type GuardedRun }
