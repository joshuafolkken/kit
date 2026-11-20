import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JOSH_SCRATCH_DIRECTORY } from '#scripts/lib/josh-temporary-directory'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
import { scratch_run_cli } from './scratch-run-cli'

const CLI = fileURLToPath(new URL('scratch-run-cli.ts', import.meta.url))
const SPAWN_TIMEOUT_MS = 30_000
const DENIED_EXIT_CODE = 0
const ALLOWED_EXIT_CODE = 7
const make_directory = temporary_directory('suite')
const SCRATCH_ROOT = '/s'
const SPAWN_OPERATION = "spawnSync('ls')"
const MARKER_SCRIPT = "import { writeFileSync } from 'node:fs'\nwriteFileSync('ran', '')\n"

// A probe exits 0 when its operation is refused by the permission model and 7 when it went through, so
// a refused network call is not confused with one that merely found nothing listening.
function probe(operation: string): string {
	return [
		"import { spawnSync } from 'node:child_process'",
		"import { writeFileSync } from 'node:fs'",
		'const denied = (error) => JSON.stringify(error, Object.getOwnPropertyNames(error)).includes(',
		"\t'ERR_ACCESS_DENIED') || (error.cause !== undefined && denied(error.cause))",
		'try {',
		`\t${operation}`,
		`\tprocess.exitCode = ${String(ALLOWED_EXIT_CODE)}`,
		'} catch (error) {',
		`\tprocess.exitCode = denied(error) ? ${String(DENIED_EXIT_CODE)} : 9`,
		'\tif (process.exitCode === 9) console.error(error)',
		'}',
	].join('\n')
}

function setup(): { root: string; scratch: string; outside: string } {
	const root = realpathSync(make_directory('scratch-run-'))
	const scratch = path.join(root, JOSH_SCRATCH_DIRECTORY)

	mkdirSync(scratch, { recursive: true })

	return { root, scratch, outside: path.join(root, 'outside') }
}

function run_probe(operation: string, flags?: ReadonlySet<string>): number {
	const { root, scratch } = setup()
	const script = path.join(scratch, 'probe.mjs')

	writeFileSync(script, probe(operation))

	return scratch_run_cli.run([script], root, flags)
}

describe('scratch:run permission arguments', () => {
	it('grants reads everywhere and writes to the scratch root only', () => {
		expect(scratch_run_cli.permission_arguments(SCRATCH_ROOT)).toEqual([
			'--permission',
			'--allow-fs-read=*',
			`--allow-fs-write=${SCRATCH_ROOT}`,
		])
	})

	it('grants no network, child process, worker or addon access', () => {
		const joined = scratch_run_cli.permission_arguments(SCRATCH_ROOT).join(' ')

		expect(joined).not.toMatch(/--allow-(?:net|child-process|worker|addons)/u)
	})
})

describe('scratch:run refusals', () => {
	it('refuses a script outside the scratch directory', () => {
		const { root, outside } = setup()

		writeFileSync(outside, MARKER_SCRIPT)

		expect(scratch_run_cli.run([outside], root)).toBe(1)
		expect(existsSync(path.join(root, 'ran'))).toBe(false)
	})

	it('refuses to start on a Node that does not know --allow-net', () => {
		const { root, scratch } = setup()
		const script = path.join(scratch, 'marker.mjs')

		writeFileSync(script, MARKER_SCRIPT)

		expect(scratch_run_cli.run([script], root, new Set<string>())).toBe(1)
		expect(existsSync(path.join(scratch, 'ran'))).toBe(false)
	})

	it('refuses a call with no script', () => {
		expect(scratch_run_cli.run([], setup().root)).toBe(1)
	})

	it('refuses a script that does not exist', () => {
		expect(
			scratch_run_cli.run([path.join(JOSH_SCRATCH_DIRECTORY, 'missing.mjs')], setup().root),
		).toBe(1)
	})
})

describe('scratch:run CLI', () => {
	it('prints the usage and exits 1 with no script', { timeout: SPAWN_TIMEOUT_MS }, () => {
		const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), CLI], {
			cwd: setup().root,
			encoding: 'utf8',
		})

		expect(result.status).toBe(1)
		expect(result.stderr).toContain('Usage: josh scratch:run')
	})
})

describe('scratch:run under the permission model', () => {
	it('lets the script write inside the scratch directory', { timeout: SPAWN_TIMEOUT_MS }, () => {
		expect(run_probe("writeFileSync('inside.txt', 'ok')")).toBe(ALLOWED_EXIT_CODE)
	})

	it('denies a write outside the scratch directory', { timeout: SPAWN_TIMEOUT_MS }, () => {
		expect(run_probe("writeFileSync('../../../outside.txt', 'no')")).toBe(DENIED_EXIT_CODE)
	})

	it('denies a network call', { timeout: SPAWN_TIMEOUT_MS }, () => {
		expect(run_probe("await fetch('http://127.0.0.1:65535/')")).toBe(DENIED_EXIT_CODE)
	})

	it('denies starting a child process', { timeout: SPAWN_TIMEOUT_MS }, () => {
		expect(run_probe(SPAWN_OPERATION)).toBe(DENIED_EXIT_CODE)
	})

	it('ignores a grant inherited through NODE_OPTIONS', { timeout: SPAWN_TIMEOUT_MS }, () => {
		vi.stubEnv('NODE_OPTIONS', '--allow-child-process')

		try {
			expect(run_probe(SPAWN_OPERATION)).toBe(DENIED_EXIT_CODE)
		} finally {
			vi.unstubAllEnvs()
		}
	})

	it('exits 1 when the script dies by a signal', { timeout: SPAWN_TIMEOUT_MS }, () => {
		expect(run_probe("process.kill(process.pid, 'SIGKILL')")).toBe(1)
	})
})
