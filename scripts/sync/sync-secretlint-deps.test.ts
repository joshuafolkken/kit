import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { package_file } from '#scripts/claude/skill-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sync } from './sync'

const make_directory = temporary_directory()
const PRESET_ID = '@secretlint/secretlint-rule-preset-recommend'
const SECRETLINT_KEY = 'secretlint'
const ctx = { work_directory: '', package_json_path: '' }

function read_development_deps(manifest_path = ctx.package_json_path): Record<string, string> {
	const parsed = JSON.parse(readFileSync(manifest_path, 'utf8')) as {
		devDependencies?: Record<string, string>
	}

	return parsed.devDependencies ?? {}
}

const MANIFEST_NAME = 'package.json'
const KIT_SECRETLINT_RANGE = read_development_deps(package_file(MANIFEST_NAME))[SECRETLINT_KEY]

function sync_manifest(content: string): Record<string, string> {
	writeFileSync(ctx.package_json_path, content)
	sync.sync_secretlint_development_deps(ctx.package_json_path)

	return read_development_deps()
}

beforeEach(() => {
	ctx.work_directory = make_directory('sync-secretlint-')
	ctx.package_json_path = path.join(ctx.work_directory, MANIFEST_NAME)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('sync.sync_secretlint_development_deps', () => {
	// `josh sync` reaches consumers that were initialized before the secretlint pre-commit
	// rule existed. Without this the synced hook would fail on every commit.
	it('adds the secretlint CLI, without the retired preset package, to a manifest that lacks it', () => {
		const deps = sync_manifest('{\n\t"name": "demo"\n}\n')

		expect(deps[SECRETLINT_KEY]).toBeDefined()
		expect(deps[PRESET_ID]).toBeUndefined()
	})

	it('leaves an already-provisioned manifest byte-identical', () => {
		const content = `{"devDependencies":{"${SECRETLINT_KEY}":"^14.0.0"}}`

		writeFileSync(ctx.package_json_path, content)
		sync.sync_secretlint_development_deps(ctx.package_json_path)

		expect(readFileSync(ctx.package_json_path, 'utf8')).toBe(content)
	})

	// secretlint v14 builds the preset in and deprecates its package; dropping the package from a
	// pre-v14 consumer is only safe with the CLI raised alongside it.
	it('drops the retired preset package and raises the CLI to the version kit carries', () => {
		const content = `{"devDependencies":{"${SECRETLINT_KEY}":"^13.1.0","${PRESET_ID}":"^13.1.0"}}`
		const deps = sync_manifest(content)

		expect(deps[PRESET_ID]).toBeUndefined()
		expect(deps[SECRETLINT_KEY]).toBe(KIT_SECRETLINT_RANGE)
	})

	it('does not touch a CLI version the consumer pinned without the preset package', () => {
		const content = `{"devDependencies":{"${SECRETLINT_KEY}":"^12.0.0"}}`

		expect(sync_manifest(content)[SECRETLINT_KEY]).toBe('^12.0.0')
	})

	it('does nothing when the manifest is missing', () => {
		expect(() => {
			sync.sync_secretlint_development_deps(ctx.package_json_path)
		}).not.toThrow()
	})
})
