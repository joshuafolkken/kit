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
// A literal, deliberately NOT built from `get_tsconfig_exclude_entries()` / `format_json`: those are
// the code under test, and generating the fixture from them would make the byte-identical assertion
// self-fulfilling. Spelled out, it fails loudly the moment kit's exclude list or its serialization
// changes — which is the signal that already-synced consumers get their file rewritten, and the
// reason to think about whether they should. Authored the way prettier emits it: `extends` fits on
// one line, `exclude` outgrew printWidth when the SvelteKit exclusions joined it (#712, #796).
const APP_KIT_TSCONFIG = `{
	"extends": ["./node_modules/@joshuafolkken/app-kit/tsconfig/sveltekit.json"],
	"exclude": [
		"node_modules",
		"build",
		"dist",
		"playwright-report",
		"test-results",
		"src/service-worker.js",
		"src/service-worker/**/*.js",
		"src/service-worker.ts",
		"src/service-worker/**/*.ts",
		"src/service-worker.d.ts",
		"src/service-worker/**/*.d.ts"
	]
}
`

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

	it('leaves an already-synced app-kit tsconfig.json byte-identical', () => {
		const result = sync_and_read(TSCONFIG_DEST, APP_KIT_TSCONFIG, sync_configs.sync_tsconfig)

		expect(result).toBe(APP_KIT_TSCONFIG)
	})
})
