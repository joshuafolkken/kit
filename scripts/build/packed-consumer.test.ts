import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build_bin } from './build-bin'
import { resolve_package_bin } from './local-bin'

// Smoke test: pack the real tarball, install in a temp consumer project, and run the published
// CLI through the bin entry. Excluded from the unit gate (slow — ~60 s setup); run before
// release with: pnpm vitest run scripts/build/packed-consumer.test.ts

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SETUP_TIMEOUT_MS = 120_000
const CMD_TIMEOUT_MS = 15_000
const PACKAGE_NAME = '@joshuafolkken/kit'
const CANNOT_FIND_MODULE = 'Cannot find module'
const ERR_MODULE_NOT_FOUND = 'ERR_MODULE_NOT_FOUND'
const CMD_TIMEOUT_MSG = 'command timed out or failed to spawn'

const fixture: { consumer_directory: string; josh_bin: string } = {
	consumer_directory: '',
	josh_bin: '',
}

beforeAll(async () => {
	await build_bin()
	fixture.consumer_directory = mkdtempSync(path.join(tmpdir(), 'kit-consumer-'))
	writeFileSync(
		path.join(fixture.consumer_directory, 'package.json'),
		JSON.stringify({ name: 'test-consumer', version: '1.0.0' }),
	)
	const pack_json = JSON.parse(
		execFileSync(
			'pnpm',
			[
				'pack',
				'--json',
				'--pack-destination',
				fixture.consumer_directory,
				'--config.ignore-scripts=true',
			],
			{ cwd: REPO_ROOT, encoding: 'utf8' },
		),
	) as { filename: string }
	const tgz = path.join(fixture.consumer_directory, pack_json.filename)

	execFileSync('pnpm', ['add', tgz], { cwd: fixture.consumer_directory, encoding: 'utf8' })
	const resolved = resolve_package_bin(fixture.consumer_directory, PACKAGE_NAME, 'josh')
	if (resolved === undefined) throw new Error(`josh bin not found after installing ${tgz}`)
	fixture.josh_bin = resolved
}, SETUP_TIMEOUT_MS)

afterAll(() => {
	if (fixture.consumer_directory !== '') {
		rmSync(fixture.consumer_directory, { recursive: true, force: true })
	}
})

describe('packed-package consumer smoke', () => {
	it('josh help exits 0 and reports the version', () => {
		const result = spawnSync('node', [fixture.josh_bin, 'help'], {
			encoding: 'utf8',
			timeout: CMD_TIMEOUT_MS,
		})

		expect(result.error, CMD_TIMEOUT_MSG).toBeUndefined()
		expect(result.status).toBe(0)
		expect(result.stdout).toContain('josh v')
	})

	it('josh init starts without a module resolution error', () => {
		const result = spawnSync('node', [fixture.josh_bin, 'init'], {
			encoding: 'utf8',
			cwd: fixture.consumer_directory,
			timeout: CMD_TIMEOUT_MS,
		})

		expect(result.error, CMD_TIMEOUT_MSG).toBeUndefined()
		expect(result.stderr).not.toContain(CANNOT_FIND_MODULE)
		expect(result.stderr).not.toContain(ERR_MODULE_NOT_FOUND)
	})

	it('josh sync starts without a module resolution error', () => {
		const result = spawnSync('node', [fixture.josh_bin, 'sync'], {
			encoding: 'utf8',
			cwd: fixture.consumer_directory,
			timeout: CMD_TIMEOUT_MS,
		})

		expect(result.error, CMD_TIMEOUT_MSG).toBeUndefined()
		expect(result.stderr).not.toContain(CANNOT_FIND_MODULE)
		expect(result.stderr).not.toContain(ERR_MODULE_NOT_FOUND)
	})
})
