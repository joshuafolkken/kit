import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sync_configs } from './sync-configs'

// An app-kit SvelteKit consumer references app-kit presets that already layer kit base. A re-sync
// must NOT add a second kit-base reference — for lefthook that would be a hard recursion crash;
// for cspell / tsconfig a redundant duplicate (#660). Each managed file must stay byte-identical.
const TEST_DIR = path.join(tmpdir(), 'sync-configs-app-kit-test')
const LEFTHOOK_DEST = path.join(TEST_DIR, 'lefthook.yml')
const CSPELL_DEST = path.join(TEST_DIR, 'cspell.config.yaml')
const TSCONFIG_DEST = path.join(TEST_DIR, 'tsconfig.json')

const APP_KIT_LEFTHOOK =
	'extends:\n  - node_modules/@joshuafolkken/app-kit/lefthook/sveltekit.yml\n'
const APP_KIT_CSPELL =
	'version: "0.2"\nimport:\n  - "@joshuafolkken/app-kit/cspell/sveltekit"\nwords: []\n'
// Authored the way prettier emits it (short exclude inline) — the no-op re-sync must preserve it.
const APP_KIT_TSCONFIG =
	'{\n\t"extends": ["./node_modules/@joshuafolkken/app-kit/tsconfig/sveltekit.jsonc"],\n\t"exclude": ["node_modules", "build", "dist"]\n}\n'

beforeEach(() => {
	mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
	vi.restoreAllMocks()
})

function sync_and_read(
	destination: string,
	content: string,
	run: (destination: string) => void,
): string {
	writeFileSync(destination, content)
	vi.spyOn(console, 'info').mockImplementation(() => {
		/* suppress */
	})
	run(destination)

	return readFileSync(destination, 'utf8')
}

describe('sync_configs — app-kit consumer leaves kit base un-doubled (#660)', () => {
	it('leaves an app-kit lefthook.yml unchanged (no double base extend)', () => {
		const result = sync_and_read(LEFTHOOK_DEST, APP_KIT_LEFTHOOK, sync_configs.sync_lefthook_config)

		expect(result).toBe(APP_KIT_LEFTHOOK)
	})

	it('leaves an app-kit cspell.config.yaml unchanged (no duplicate import)', () => {
		const result = sync_and_read(CSPELL_DEST, APP_KIT_CSPELL, sync_configs.sync_cspell_config)

		expect(result).toBe(APP_KIT_CSPELL)
	})

	it('leaves an app-kit tsconfig.json unchanged with exclude on one line', () => {
		const result = sync_and_read(TSCONFIG_DEST, APP_KIT_TSCONFIG, sync_configs.sync_tsconfig)

		expect(result).toBe(APP_KIT_TSCONFIG)
		expect(result).toContain('"exclude": ["node_modules", "build", "dist"]')
	})
})
