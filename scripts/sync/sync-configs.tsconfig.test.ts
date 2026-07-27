import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { init_logic } from '#scripts/init/init-logic'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sync_configs } from './sync-configs'

const TEST_DIR = path.join(tmpdir(), 'sync-configs-tsconfig-test')
const TSCONFIG_DEST = path.join(TEST_DIR, 'tsconfig.json')
const ENTRY = init_logic.get_tsconfig_extends_entry()
const NO_EMIT_ON_ERROR = 'noEmitOnError'

beforeEach(() => {
	mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
	vi.restoreAllMocks()
})

function sync_and_read(content: string): Record<string, unknown> {
	writeFileSync(TSCONFIG_DEST, content)
	vi.spyOn(console, 'info').mockImplementation(() => {
		/* suppress */
	})
	sync_configs.sync_tsconfig(TSCONFIG_DEST)

	return JSON.parse(readFileSync(TSCONFIG_DEST, 'utf8')) as Record<string, unknown>
}

describe('sync_configs.sync_tsconfig — normalization', () => {
	it('strips compilerOptions that duplicate the base preset', () => {
		const content = `${JSON.stringify({
			extends: [ENTRY],
			compilerOptions: { strict: true, esModuleInterop: true },
		})}\n`

		expect(sync_and_read(content)).toStrictEqual({ extends: [ENTRY] })
	})

	it('preserves a value-divergent override while stripping redundant keys', () => {
		const content = `${JSON.stringify({
			extends: [ENTRY],
			compilerOptions: { strict: true, [NO_EMIT_ON_ERROR]: false },
		})}\n`
		const result = sync_and_read(content) as { compilerOptions: Record<string, unknown> }

		expect(result.compilerOptions).toStrictEqual({ [NO_EMIT_ON_ERROR]: false })
	})

	it('logs unchanged when already minimal with no redundant options', () => {
		const content = `${JSON.stringify({ extends: [ENTRY] }, undefined, '\t')}\n`

		writeFileSync(TSCONFIG_DEST, content)
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})

		sync_configs.sync_tsconfig(TSCONFIG_DEST)

		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining('unchanged'))
		expect(readFileSync(TSCONFIG_DEST, 'utf8')).toBe(content)
	})
})

// A consumer upgrading from a kit that shipped `*.jsonc` presets cannot start Playwright at all
// until its `extends` points at the `.json` path, and the ecosystem-preset check would otherwise
// consider the stale entry "already present" and leave it alone. `josh sync` must repair it (#681).
const KIT_LEGACY = './node_modules/@joshuafolkken/kit/tsconfig/base.jsonc'
const APP_KIT_LEGACY = './node_modules/@joshuafolkken/app-kit/tsconfig/sveltekit.jsonc'
const APP_KIT_CURRENT = './node_modules/@joshuafolkken/app-kit/tsconfig/sveltekit.json'

function install_preset(relative_path: string): void {
	const absolute = path.join(TEST_DIR, relative_path)

	mkdirSync(path.dirname(absolute), { recursive: true })
	writeFileSync(absolute, '{ "compilerOptions": {} }\n')
}

describe('sync_configs.sync_tsconfig — legacy .jsonc preset migration', () => {
	it('rewrites a stale kit preset path to the shipped .json preset', () => {
		install_preset(ENTRY)
		const content = `${JSON.stringify({ extends: [KIT_LEGACY] })}\n`

		expect(sync_and_read(content)).toStrictEqual({ extends: [ENTRY] })
	})

	it('rewrites a stale app-kit preset path without adding kit base', () => {
		install_preset(APP_KIT_CURRENT)
		const content = `${JSON.stringify({ extends: [APP_KIT_LEGACY] })}\n`

		expect(sync_and_read(content)).toStrictEqual({ extends: [APP_KIT_CURRENT] })
	})

	// Until the package shipping the renamed preset is installed, rewriting would point tsc at a
	// file that does not exist — strictly worse than leaving the stale entry in place (#681).
	it('leaves a stale entry alone while the renamed preset is not installed', () => {
		const content = `${JSON.stringify({ extends: [APP_KIT_LEGACY] })}\n`

		expect(sync_and_read(content)).toStrictEqual({ extends: [APP_KIT_LEGACY] })
	})
})

describe('sync_configs.sync_tsconfig — prettier-clean serialization', () => {
	// When strip rewrites the file, a short `exclude` must stay on one line so the emitted tsconfig
	// is prettier-clean (#660) — JSON.stringify would otherwise expand it multi-line.
	it('keeps a short exclude inline after stripping a redundant option', () => {
		const content = `${JSON.stringify({
			extends: [ENTRY],
			compilerOptions: { strict: true },
			exclude: ['node_modules', 'build', 'dist'],
		})}\n`
		const result = sync_and_read(content)

		expect(result).toStrictEqual({ extends: [ENTRY], exclude: ['node_modules', 'build', 'dist'] })
		expect(readFileSync(TSCONFIG_DEST, 'utf8')).toContain(
			'"exclude": ["node_modules", "build", "dist"]',
		)
	})
})
