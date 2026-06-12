import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { init_logic, type ProjectType } from '#scripts/init/init-logic'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sync_configs } from './sync-configs'

const TEST_DIR = path.join(tmpdir(), 'sync-configs-tsconfig-test')
const TSCONFIG_DEST = path.join(TEST_DIR, 'tsconfig.json')
const TYPE: ProjectType = 'vanilla'
const ENTRY = init_logic.get_tsconfig_extends_entry(TYPE)
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
	sync_configs.sync_tsconfig(TSCONFIG_DEST, TYPE)

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

		sync_configs.sync_tsconfig(TSCONFIG_DEST, TYPE)

		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining('unchanged'))
		expect(readFileSync(TSCONFIG_DEST, 'utf8')).toBe(content)
	})
})
