import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { init_logic_json_merge } from './init-logic-json-merge'

// A consumer left on the retired `.jsonc` preset path already satisfies the ecosystem-preset check,
// so the ensure-based merge alone would report "already present" and leave Playwright unable to load
// the config at all. The merge must rewrite the extension instead of adding a second entry (#681).
const KIT_TSCONFIG_BASE = './node_modules/@joshuafolkken/kit/tsconfig/base.json'
const KIT_TSCONFIG_LEGACY = './node_modules/@joshuafolkken/kit/tsconfig/base.jsonc'
const APP_KIT_TSCONFIG = './node_modules/@joshuafolkken/app-kit/tsconfig/sveltekit.json'
const APP_KIT_TSCONFIG_LEGACY = './node_modules/@joshuafolkken/app-kit/tsconfig/sveltekit.jsonc'
const SVELTE_KIT_GENERATED = './.svelte-kit/tsconfig.json'

const TEST_DIR = path.join(tmpdir(), 'init-logic-json-merge-tsconfig-migration-test')

function install_preset(relative_path: string): void {
	const absolute = path.join(TEST_DIR, relative_path)

	mkdirSync(path.dirname(absolute), { recursive: true })
	writeFileSync(absolute, '{ "compilerOptions": {} }\n')
}

function merge_extends(content: string): ReadonlyArray<string> {
	const result = JSON.parse(
		init_logic_json_merge.merge_tsconfig_extends(content, KIT_TSCONFIG_BASE, TEST_DIR),
	) as { extends: ReadonlyArray<string> }

	return result.extends
}

beforeEach(() => {
	mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('init_logic_json_merge.merge_tsconfig_extends — legacy .jsonc preset migration', () => {
	it('rewrites a legacy kit preset path instead of adding a duplicate entry', () => {
		install_preset(KIT_TSCONFIG_BASE)

		expect(merge_extends(`{"extends":["${KIT_TSCONFIG_LEGACY}"]}`)).toStrictEqual([
			KIT_TSCONFIG_BASE,
		])
	})

	it('rewrites a legacy app-kit preset path without adding kit base', () => {
		install_preset(APP_KIT_TSCONFIG)
		const content = `{"extends":["${APP_KIT_TSCONFIG_LEGACY}","${SVELTE_KIT_GENERATED}"]}`

		expect(merge_extends(content)).toStrictEqual([APP_KIT_TSCONFIG, SVELTE_KIT_GENERATED])
	})

	// With the renamed preset not installed yet the entry must stay put — and kit base must still not
	// be injected alongside it, or the consumer ends up double-extending the ecosystem preset (#660).
	it('leaves a legacy entry alone and adds no kit base when the target is missing', () => {
		const content = `{"extends":["${APP_KIT_TSCONFIG_LEGACY}"]}`

		expect(init_logic_json_merge.merge_tsconfig_extends(content, KIT_TSCONFIG_BASE, TEST_DIR)).toBe(
			content,
		)
	})
})
