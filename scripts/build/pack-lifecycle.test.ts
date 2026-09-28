import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { SCRIPTS_DIR } from './import-closure-fixture'

// joshuafolkken/kit#2693: kit's own `preinstall` (Safe Chain for kit's development installs) shipped
// in the published manifest, where every consumer's pnpm refused it as an unapproved build script.
// The repository keeps it; `.pnpmfile.mjs` strips it from the packed copy. The packed manifest is
// read from a real `pnpm pack`, so a hook pnpm stops calling is caught here rather than shipping.
// `--config.ignore-scripts=true` skips the prepack build; it does not skip pnpmfile hooks.

const REPO_ROOT = path.dirname(SCRIPTS_DIR)
const PACK_TIMEOUT_MS = 120_000

interface Manifest {
	scripts?: Record<string, string>
}

interface PnpmfileModule {
	install_lifecycle_scripts: ReadonlySet<string>
}

const pnpmfile_url = pathToFileURL(path.join(REPO_ROOT, '.pnpmfile.mjs')).href
const { install_lifecycle_scripts } = (await import(pnpmfile_url)) as PnpmfileModule
const out_directory = mkdtempSync(path.join(os.tmpdir(), 'josh-pack-lifecycle-'))

afterAll(() => {
	rmSync(out_directory, { recursive: true, force: true })
})

function repository_manifest(): Manifest {
	return JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as Manifest
}

function packed_manifest(): Manifest {
	execFileSync(
		'pnpm',
		['pack', '--pack-destination', out_directory, '--config.ignore-scripts=true'],
		{ cwd: REPO_ROOT, stdio: 'ignore' },
	)
	const tarball = readdirSync(out_directory).find((name) => name.endsWith('.tgz')) ?? ''
	const raw = execFileSync(
		'tar',
		['-xzOf', path.join(out_directory, tarball), 'package/package.json'],
		{ encoding: 'utf8' },
	)

	return JSON.parse(raw) as Manifest
}

describe('the published package lifecycle scripts', () => {
	it('keeps the Safe Chain preinstall in the repository manifest', () => {
		expect(repository_manifest().scripts?.['preinstall']).toContain('safe-chain')
	})

	it(
		'ships no install-time lifecycle script and keeps the rest',
		() => {
			const scripts = packed_manifest().scripts ?? {}

			expect(Object.keys(scripts).filter((name) => install_lifecycle_scripts.has(name))).toEqual([])
			expect(scripts['josh']).toBe(repository_manifest().scripts?.['josh'])
		},
		PACK_TIMEOUT_MS,
	)
})
