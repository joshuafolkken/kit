import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sync } from './sync'

const ctx = { package_json_path: '', work_directory: '' }

function write_manifest(on_fail: string): string {
	const content = JSON.stringify(
		{ devEngines: { packageManager: { name: 'pnpm', version: '12.6.0', onFail: on_fail } } },
		undefined,
		'\t',
	)

	writeFileSync(ctx.package_json_path, content)

	return content
}

function read_on_fail(): unknown {
	const manifest = JSON.parse(readFileSync(ctx.package_json_path, 'utf8')) as {
		devEngines: { packageManager: { onFail: unknown } }
	}

	return manifest.devEngines.packageManager.onFail
}

beforeEach(() => {
	ctx.work_directory = mkdtempSync(path.join(tmpdir(), 'sync-package-manager-on-fail-'))
	ctx.package_json_path = path.join(ctx.work_directory, 'package.json')
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
	rmSync(ctx.work_directory, { recursive: true, force: true })
	vi.restoreAllMocks()
})

// joshuafolkken/kit#3388: an initialized consumer never re-runs `josh init`, so `josh sync` is the
// route by which its manifest stops rejecting a standalone pnpm of another version.
describe('sync_package_manager_on_fail', () => {
	it('moves an onFail of error to download', () => {
		write_manifest('error')
		sync.sync_package_manager_on_fail(ctx.package_json_path)

		expect(read_on_fail()).toBe('download')
	})

	it('runs as one of the manifest migrations josh sync applies', () => {
		write_manifest('error')
		sync.sync_package_json_migrations(ctx.package_json_path)

		expect(read_on_fail()).toBe('download')
	})

	it('leaves an onFail the project chose byte-identical', () => {
		const content = write_manifest('warn')

		sync.sync_package_manager_on_fail(ctx.package_json_path)

		expect(readFileSync(ctx.package_json_path, 'utf8')).toBe(content)
	})
})
