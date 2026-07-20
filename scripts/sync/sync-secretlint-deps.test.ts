import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sync } from './sync'

const PRESET_ID = '@secretlint/secretlint-rule-preset-recommend'
const SECRETLINT_KEY = 'secretlint'

const ctx = { work_directory: '', package_json_path: '' }

function read_development_deps(): Record<string, string> {
	const parsed = JSON.parse(readFileSync(ctx.package_json_path, 'utf8')) as {
		devDependencies?: Record<string, string>
	}

	return parsed.devDependencies ?? {}
}

function sync_manifest(content: string): Record<string, string> {
	writeFileSync(ctx.package_json_path, content)
	sync.sync_secretlint_development_deps(ctx.package_json_path)

	return read_development_deps()
}

beforeEach(() => {
	ctx.work_directory = mkdtempSync(path.join(tmpdir(), 'sync-secretlint-'))
	ctx.package_json_path = path.join(ctx.work_directory, 'package.json')
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
	rmSync(ctx.work_directory, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('sync.sync_secretlint_development_deps', () => {
	// `josh sync` reaches consumers that were initialized before the secretlint pre-commit
	// rule existed. Without this the synced hook would fail on every commit.
	it('adds the secretlint dependencies to a manifest that lacks them', () => {
		const deps = sync_manifest('{\n\t"name": "demo"\n}\n')

		expect(deps[SECRETLINT_KEY]).toBeDefined()
		expect(deps[PRESET_ID]).toBeDefined()
	})

	it('leaves an already-provisioned manifest byte-identical', () => {
		const content = `{"devDependencies":{"${SECRETLINT_KEY}":"^13.0.2","${PRESET_ID}":"^13.0.2"}}`

		writeFileSync(ctx.package_json_path, content)
		sync.sync_secretlint_development_deps(ctx.package_json_path)

		expect(readFileSync(ctx.package_json_path, 'utf8')).toBe(content)
	})

	it('does not downgrade a version the consumer pinned themselves', () => {
		const content = `{"devDependencies":{"${SECRETLINT_KEY}":"^12.0.0","${PRESET_ID}":"^12.0.0"}}`

		expect(sync_manifest(content)[SECRETLINT_KEY]).toBe('^12.0.0')
	})

	it('does nothing when the manifest is missing', () => {
		expect(() => {
			sync.sync_secretlint_development_deps(ctx.package_json_path)
		}).not.toThrow()
	})
})
