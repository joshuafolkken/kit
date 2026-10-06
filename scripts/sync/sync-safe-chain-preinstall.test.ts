import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { init_logic } from '#scripts/init/init-logic'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sync } from './sync'

// The `preinstall` an earlier `josh init` wrote: an unverified safe-chain fetched on every install.
const LEGACY_PREINSTALL = 'pnpm dlx @aikidosec/safe-chain@1.5.20 setup-ci'
const CONSUMER_PREINSTALL = 'npx only-allow pnpm'

const ctx = { package_json_path: '', work_directory: '' }

function write_manifest(preinstall: string): string {
	const content = JSON.stringify({ scripts: { preinstall } })

	writeFileSync(ctx.package_json_path, content)

	return content
}

function sync_preinstall(preinstall: string): string {
	write_manifest(preinstall)
	sync.sync_safe_chain_preinstall(ctx.package_json_path)

	const manifest = JSON.parse(readFileSync(ctx.package_json_path, 'utf8')) as {
		scripts: Record<string, string>
	}

	return manifest.scripts['preinstall'] ?? ''
}

beforeEach(() => {
	ctx.work_directory = mkdtempSync(path.join(tmpdir(), 'sync-safe-chain-preinstall-'))
	ctx.package_json_path = path.join(ctx.work_directory, 'package.json')
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
	rmSync(ctx.work_directory, { recursive: true, force: true })
	vi.restoreAllMocks()
})

// joshuafolkken/kit#3269: an initialized consumer never re-runs `josh init`, so `josh sync` is the only
// route by which it stops fetching safe-chain on every install.
describe('sync_safe_chain_preinstall', () => {
	it('replaces the preinstall an earlier josh init wrote', () => {
		expect(sync_preinstall(LEGACY_PREINSTALL)).toBe(init_logic.SAFE_CHAIN_CMD)
	})

	it('runs as one of the manifest migrations josh sync applies', () => {
		write_manifest(LEGACY_PREINSTALL)
		sync.sync_package_json_migrations(ctx.package_json_path)

		expect(readFileSync(ctx.package_json_path, 'utf8')).toContain(
			JSON.stringify(init_logic.SAFE_CHAIN_CMD),
		)
	})

	it('leaves a consumer-authored preinstall untouched', () => {
		expect(sync_preinstall(CONSUMER_PREINSTALL)).toBe(CONSUMER_PREINSTALL)
	})

	it('leaves an already-upgraded manifest byte-identical', () => {
		const content = write_manifest(init_logic.SAFE_CHAIN_CMD)

		sync.sync_safe_chain_preinstall(ctx.package_json_path)

		expect(readFileSync(ctx.package_json_path, 'utf8')).toBe(content)
	})

	it('does nothing when the manifest is missing', () => {
		expect(() => {
			sync.sync_safe_chain_preinstall(ctx.package_json_path)
		}).not.toThrow()
	})
})
