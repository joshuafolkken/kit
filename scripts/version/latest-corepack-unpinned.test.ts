import { readFileSync, writeFileSync } from 'node:fs'
import { execaSync } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { latest_corepack } from './latest-corepack'
import {
	AGED_PUBLISH,
	fake_sync_result,
	NPMRC_AGE_1440,
	NPMRC_PATH,
} from './latest-corepack-fixture'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('node:fs', () => ({ readFileSync: vi.fn(), writeFileSync: vi.fn() }))

const PINNED_VERSION = '11.4.0+sha512.abc'
const MANIFEST = JSON.stringify({
	name: 'consumer',
	devEngines: { packageManager: { name: 'pnpm', version: PINNED_VERSION, onFail: 'error' } },
})
const TIMES = `{"11.5.2":"${AGED_PUBLISH}","12.7.0":"${AGED_PUBLISH}"}`
const INTEGRITY = `sha512-${Buffer.alloc(64, 1).toString('base64')}`

beforeEach(() => {
	vi.resetAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('latest_corepack without a packageManager pin', () => {
	it('uses an existing devEngines version as the major and version floor', () => {
		expect(latest_corepack.extract_pnpm_major(MANIFEST)).toBe('11')
		expect(latest_corepack.extract_pinned_version(MANIFEST)).toBe('11.4.0')
	})

	it('pins the latest release on the devEngines major', () => {
		vi.mocked(readFileSync).mockImplementation((file) =>
			file === NPMRC_PATH ? NPMRC_AGE_1440 : MANIFEST,
		)
		vi.mocked(execaSync).mockReturnValueOnce(fake_sync_result(0, TIMES))
		vi.mocked(execaSync).mockReturnValueOnce(fake_sync_result(0, JSON.stringify(INTEGRITY)))
		vi.mocked(execaSync).mockReturnValueOnce(fake_sync_result(0, '11.5.2'))

		latest_corepack.main()

		const written = vi.mocked(writeFileSync).mock.calls[0]?.[1]

		expect(written).toContain('"packageManager": "pnpm@11.5.2+sha512.')
		expect(written).toContain('"version": "11.5.2+sha512.')
		expect(written).toContain('"onFail": "error"')
		expect(vi.mocked(execaSync).mock.calls[0]?.[1]).toEqual(['view', 'pnpm', 'time', '--json'])
	})
})
