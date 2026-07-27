import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tsconfig_preset_migration } from './tsconfig-preset-migration'

const KIT_LEGACY = './node_modules/@joshuafolkken/kit/tsconfig/base.jsonc'
const KIT_CURRENT = './node_modules/@joshuafolkken/kit/tsconfig/base.json'
const APP_KIT_LEGACY = './node_modules/@joshuafolkken/app-kit/tsconfig/sveltekit.jsonc'
const APP_KIT_CURRENT = './node_modules/@joshuafolkken/app-kit/tsconfig/sveltekit.json'
const SVELTE_KIT_GENERATED = './.svelte-kit/tsconfig.json'

const TEST_DIR = path.join(tmpdir(), 'tsconfig-preset-migration-test')

// The migration only rewrites an entry whose renamed target is actually installed, so every
// "rewrites" case needs the `.json` preset present on disk.
function install_preset(relative_path: string): void {
	const absolute = path.join(TEST_DIR, relative_path)

	mkdirSync(path.dirname(absolute), { recursive: true })
	writeFileSync(absolute, '{ "compilerOptions": {} }\n')
}

function migrate(content: string): string {
	return tsconfig_preset_migration.migrate_preset_paths(content, TEST_DIR)
}

function migrate_parsed(content: string): Record<string, unknown> {
	return JSON.parse(migrate(content)) as Record<string, unknown>
}

beforeEach(() => {
	mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('tsconfig_preset_migration.migrate_preset_paths — legacy .jsonc presets (#681)', () => {
	it('rewrites a kit preset authored as a bare string, keeping the string shape', () => {
		install_preset(KIT_CURRENT)

		expect(migrate_parsed(JSON.stringify({ extends: KIT_LEGACY }))).toStrictEqual({
			extends: KIT_CURRENT,
		})
	})

	it('rewrites an app-kit preset entry inside an array, leaving siblings alone', () => {
		install_preset(APP_KIT_CURRENT)
		const content = JSON.stringify({ extends: [APP_KIT_LEGACY, SVELTE_KIT_GENERATED] })

		expect(migrate_parsed(content)).toStrictEqual({
			extends: [APP_KIT_CURRENT, SVELTE_KIT_GENERATED],
		})
	})

	it('preserves every other key when rewriting', () => {
		install_preset(KIT_CURRENT)
		const content = JSON.stringify({
			extends: [KIT_LEGACY],
			compilerOptions: { noEmitOnError: false },
			exclude: ['node_modules'],
		})

		expect(migrate_parsed(content)).toStrictEqual({
			extends: [KIT_CURRENT],
			compilerOptions: { noEmitOnError: false },
			exclude: ['node_modules'],
		})
	})
})

describe('tsconfig_preset_migration.migrate_preset_paths — leaves unrelated content untouched', () => {
	it('returns the input byte-identical when the preset is already .json', () => {
		install_preset(KIT_CURRENT)
		const content = `${JSON.stringify({ extends: [KIT_CURRENT] }, undefined, '\t')}\n`

		expect(migrate(content)).toBe(content)
	})

	it('returns the input byte-identical when there is no extends field', () => {
		const content = `${JSON.stringify({ compilerOptions: { strict: true } }, undefined, '\t')}\n`

		expect(migrate(content)).toBe(content)
	})

	it('leaves a project-local .jsonc config that is not a kit preset alone', () => {
		const local = './config/tsconfig.base.jsonc'

		install_preset('./config/tsconfig.base.json')
		const content = `${JSON.stringify({ extends: [local] }, undefined, '\t')}\n`

		expect(migrate(content)).toBe(content)
	})

	it('leaves a kit preset path whose .jsonc is not the final extension alone', () => {
		const nested = './node_modules/@joshuafolkken/kit/tsconfig/base.jsonc.bak'
		const content = `${JSON.stringify({ extends: [nested] }, undefined, '\t')}\n`

		expect(migrate(content)).toBe(content)
	})

	// The rename lands package by package; until the installed app-kit ships `sveltekit.json`,
	// rewriting the entry would point tsc at a file that does not exist (#681).
	it('leaves a legacy preset alone while the renamed target is not installed yet', () => {
		const content = `${JSON.stringify({ extends: [APP_KIT_LEGACY] }, undefined, '\t')}\n`

		expect(migrate(content)).toBe(content)
	})
})
