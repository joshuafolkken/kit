import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { init_logic } from '#scripts/init/init-logic'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sync } from './sync'

// The clause `josh init` used to write: a bare install whose failure is swallowed.
const LEGACY_LEFTHOOK_CMD = 'command -v lefthook >/dev/null 2>&1 && lefthook install'
const SVELTE_KIT_SYNC = 'svelte-kit sync'
const WARNING_MARKER = 'git hooks are NOT installed'
const PREPARE = 'prepare'

const ctx = { package_json_path: '', work_directory: '' }

function write_manifest(prepare: string): string {
	const content = JSON.stringify({ scripts: { [PREPARE]: prepare } })

	writeFileSync(ctx.package_json_path, content)

	return content
}

function sync_prepare(prepare: string): string {
	write_manifest(prepare)
	sync.sync_prepare_lefthook_warning(ctx.package_json_path)

	const manifest = JSON.parse(readFileSync(ctx.package_json_path, 'utf8')) as {
		scripts: Record<string, string>
	}

	return manifest.scripts[PREPARE] ?? ''
}

beforeEach(() => {
	ctx.work_directory = mkdtempSync(path.join(tmpdir(), 'sync-prepare-lefthook-'))
	ctx.package_json_path = path.join(ctx.work_directory, 'package.json')
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
	rmSync(ctx.work_directory, { recursive: true, force: true })
	vi.restoreAllMocks()
})

// `josh init` reaches only fresh projects; an existing consumer upgrades through `josh sync`, and
// without this it stays on the silent install joshuafolkken/kit#1503 was filed to remove.
describe('sync_prepare_lefthook_warning', () => {
	it('adds the warning to a manifest an earlier josh init wrote', () => {
		expect(sync_prepare(LEGACY_LEFTHOOK_CMD)).toContain(WARNING_MARKER)
	})

	// The consumer's own steps sit in the same string; replacing the whole value would discard them.
	it("leaves the rest of the consumer's prepare alone", () => {
		const upgraded = sync_prepare(`${SVELTE_KIT_SYNC} && ${LEGACY_LEFTHOOK_CMD}`)

		expect(upgraded).toContain(SVELTE_KIT_SYNC)
		expect(upgraded).toContain(WARNING_MARKER)
	})

	it('leaves an already-upgraded manifest byte-identical', () => {
		const content = write_manifest(init_logic.GUARDED_LEFTHOOK_CMD)

		sync.sync_prepare_lefthook_warning(ctx.package_json_path)

		expect(readFileSync(ctx.package_json_path, 'utf8')).toBe(content)
	})

	it("leaves a prepare that never carried kit's lefthook clause untouched", () => {
		expect(sync_prepare(SVELTE_KIT_SYNC)).toBe(SVELTE_KIT_SYNC)
	})

	it('does nothing when the manifest is missing', () => {
		expect(() => {
			sync.sync_prepare_lefthook_warning(ctx.package_json_path)
		}).not.toThrow()
	})
})
