import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pack_hook, PACK_HOOK_FILE } from './pack-hook'
import { safe_chain_preinstall } from './preinstall-command'

// joshuafolkken/kit#3110: a project kit sets up carries the Safe Chain `preinstall`; a published one
// shipped it, and every consumer's `pnpm add` failed on the unapproved build script.

const PACKAGE_DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PACK_TIMEOUT_MS = 60_000
const OWN_HOOK = 'export const hooks = {}\n'
const OWN_POSTINSTALL = 'node download-binary.js'
const WORKSPACE_FILE = 'pnpm-workspace.yaml'
const LEGACY_HOOK_FILE = '.pnpmfile.cjs'
const directories: Array<string> = []

interface Manifest {
	scripts?: Record<string, string>
}

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
	vi.restoreAllMocks()
})

function project(manifest: Record<string, unknown>): string {
	const root = mkdtempSync(path.join(os.tmpdir(), 'josh-pack-hook-'))

	directories.push(root)
	writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest))
	vi.spyOn(console, 'info').mockImplementation(vi.fn())

	return root
}

function published(): string {
	const preinstall = safe_chain_preinstall.SAFE_CHAIN_CMD
	const scripts = { preinstall, postinstall: OWN_POSTINSTALL, build: 'b' }

	return project({ name: 'published', version: '1.0.0', scripts })
}

function hook_text(root: string): string {
	return readFileSync(path.join(root, PACK_HOOK_FILE), 'utf8')
}

function packed_manifest(root: string): Manifest {
	execFileSync('pnpm', ['pack', '--pack-destination', root], { cwd: root, stdio: 'ignore' })
	const tarball = path.join(root, 'published-1.0.0.tgz')
	const raw = execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' })

	return JSON.parse(raw) as Manifest
}

describe('the pack hook a publishing project receives', () => {
	it('is kit own pnpmfile, recognized by its managed first line', () => {
		expect(hook_text(PACKAGE_DIRECTORY).startsWith(pack_hook.MANAGED_LINE)).toBe(true)
	})

	it('writes kit pnpmfile into a published package, then leaves it unchanged', () => {
		const root = published()

		expect(pack_hook.sync_pack_hook(root, PACKAGE_DIRECTORY)).toBe('written')
		expect(hook_text(root)).toBe(hook_text(PACKAGE_DIRECTORY))
		expect(pack_hook.sync_pack_hook(root, PACKAGE_DIRECTORY)).toBe('unchanged')
	})

	it('writes nothing into a private package', () => {
		const root = project({ name: 'app', private: true })

		expect(pack_hook.sync_pack_hook(root, PACKAGE_DIRECTORY)).toBe('private')
		expect(() => hook_text(root)).toThrow()
	})

	it(
		'packs the published manifest without the Safe Chain preinstall',
		() => {
			const root = published()

			pack_hook.sync_pack_hook(root, PACKAGE_DIRECTORY)
			const scripts = packed_manifest(root).scripts ?? {}

			expect(scripts['preinstall']).toBeUndefined()
			expect(scripts['postinstall']).toBe(OWN_POSTINSTALL)
			expect(scripts['build']).toBe('b')
		},
		PACK_TIMEOUT_MS,
	)
})

describe('a project with its own pnpmfile', () => {
	it('keeps a pnpmfile the project wrote itself', () => {
		const root = published()

		writeFileSync(path.join(root, PACK_HOOK_FILE), OWN_HOOK)

		expect(pack_hook.sync_pack_hook(root, PACKAGE_DIRECTORY)).toBe('owned')
		expect(hook_text(root)).toBe(OWN_HOOK)
	})

	// pnpm prefers `.pnpmfile.mjs` over `.pnpmfile.cjs` and loads neither once a setting names another
	// file, so writing ours there would drop the project's hooks or report one pnpm never runs.
	it.each([
		[LEGACY_HOOK_FILE, OWN_HOOK],
		[WORKSPACE_FILE, 'pnpmfile: hooks.cjs\n'],
		[WORKSPACE_FILE, 'pnpmfiles:\n  - hooks.cjs\n'],
		['.npmrc', 'pnpmfile=hooks.cjs\n'],
	])('writes nothing when %s carries %j', (name, content) => {
		const root = published()

		writeFileSync(path.join(root, name), content)

		expect(pack_hook.sync_pack_hook(root, PACKAGE_DIRECTORY)).toBe('owned')
		expect(() => hook_text(root)).toThrow()
	})

	it('removes the kit copy written before the project added its own .pnpmfile.cjs', () => {
		const root = published()

		pack_hook.sync_pack_hook(root, PACKAGE_DIRECTORY)
		writeFileSync(path.join(root, LEGACY_HOOK_FILE), OWN_HOOK)

		expect(pack_hook.sync_pack_hook(root, PACKAGE_DIRECTORY)).toBe('withdrawn')
		expect(() => hook_text(root)).toThrow()
	})
})
