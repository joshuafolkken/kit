import { readFileSync, writeFileSync } from 'node:fs'
import { execaSync } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { latest_corepack } from './latest-corepack'
import {
	AGED_PUBLISH,
	fake_sync_result,
	PACKAGE_JSON_PATH,
	QUARANTINED_PUBLISH,
	WORKSPACE_AGE_1440,
} from './latest-corepack-fixture'
import { build_package_manager_manifest } from './package-manager-manifest-fixture'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('node:fs', () => ({ readFileSync: vi.fn(), writeFileSync: vi.fn() }))

// #3361: a failed pnpm bump used to be swallowed as a skip (exit 0), so `josh latest` recorded
// the run as fresh and the pin never moved. Every failure path now exits non-zero with the
// manifest restored, while a not-newer registry answer stays a non-fatal skip.

const mocked_execa_sync = vi.mocked(execaSync)
const mocked_read_file_sync = vi.mocked(readFileSync)
const mocked_write_file_sync = vi.mocked(writeFileSync)

const PIN = '11.5.0+sha512.abc'
const MANIFEST = build_package_manager_manifest(`pnpm@${PIN}`, PIN)
const TIMES_JSON = `{"11.5.0":"${AGED_PUBLISH}","11.5.2":"${AGED_PUBLISH}"}`
const TIMES_JSON_ALL_QUARANTINED = `{"11.5.2":"${QUARANTINED_PUBLISH}"}`
const REGISTRY_INTEGRITY = JSON.stringify(`sha512-${Buffer.alloc(64, 1).toString('base64')}`)
const COREPACK_CODE = 'ERR_PNPM_CANT_SELF_UPDATE_IN_COREPACK'
const FAILURE = 1
const SELF_UPDATE_FAILURE = 'pnpm self-update exited 1'

beforeEach(() => {
	vi.resetAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

function printed_errors(): string {
	return vi
		.mocked(console.error)
		.mock.calls.map((call) => String(call[0]))
		.join('\n')
}

// Reads arrive in main's order: package.json, the quarantine window, then the alignment re-read.
function arrange_manifest_reads(): void {
	mocked_read_file_sync.mockReturnValueOnce(MANIFEST)
	mocked_read_file_sync.mockReturnValueOnce(WORKSPACE_AGE_1440)
	mocked_read_file_sync.mockReturnValue(MANIFEST)
}

describe('latest_corepack.main when pnpm self-update fails', () => {
	it('exits non-zero and restores package.json', () => {
		arrange_manifest_reads()
		mocked_execa_sync.mockReturnValueOnce(fake_sync_result(0, TIMES_JSON))
		mocked_execa_sync.mockReturnValueOnce(fake_sync_result(0, REGISTRY_INTEGRITY))
		mocked_execa_sync.mockReturnValueOnce(fake_sync_result(FAILURE))

		expect(latest_corepack.main()).toBe(FAILURE)
		expect(mocked_write_file_sync).toHaveBeenCalledWith(PACKAGE_JSON_PATH, MANIFEST)
		expect(printed_errors()).toContain(SELF_UPDATE_FAILURE)
	})

	it('exits non-zero when the self-update wrote an unexpected pin', () => {
		arrange_manifest_reads()
		mocked_execa_sync.mockReturnValueOnce(fake_sync_result(0, TIMES_JSON))
		mocked_execa_sync.mockReturnValueOnce(fake_sync_result(0, REGISTRY_INTEGRITY))
		mocked_execa_sync.mockReturnValueOnce(fake_sync_result(0))

		expect(latest_corepack.main()).toBe(FAILURE)
		expect(mocked_write_file_sync).toHaveBeenCalledWith(PACKAGE_JSON_PATH, MANIFEST)
	})

	it('exits non-zero without running self-update when no integrity is published', () => {
		arrange_manifest_reads()
		mocked_execa_sync.mockReturnValueOnce(fake_sync_result(0, TIMES_JSON))
		mocked_execa_sync.mockReturnValueOnce(fake_sync_result(FAILURE))

		expect(latest_corepack.main()).toBe(FAILURE)
		expect(mocked_execa_sync).toHaveBeenCalledTimes(2)
		expect(mocked_write_file_sync).not.toHaveBeenCalled()
	})
})

describe('latest_corepack.main when no target resolves', () => {
	it('exits non-zero without touching package.json when the registry cannot answer', () => {
		mocked_read_file_sync.mockReturnValue(MANIFEST)
		mocked_execa_sync.mockReturnValue(fake_sync_result(FAILURE, ''))

		expect(latest_corepack.main()).toBe(FAILURE)
		expect(mocked_execa_sync).toHaveBeenCalledTimes(1)
		expect(mocked_write_file_sync).not.toHaveBeenCalled()
		expect(printed_errors()).toContain('the registry did not answer')
	})
})

describe('latest_corepack.main when there is nothing to adopt', () => {
	// The kit#768 case: the registry answered, but nothing on the major has aged past the window
	// yet. Failing here would stall every run for up to the whole window, so it stays a skip.
	it('exits zero without touching package.json when every release is quarantined', () => {
		arrange_manifest_reads()
		mocked_execa_sync.mockReturnValue(fake_sync_result(0, TIMES_JSON_ALL_QUARANTINED))

		expect(latest_corepack.main()).toBe(0)
		expect(mocked_execa_sync).toHaveBeenCalledTimes(1)
		expect(mocked_write_file_sync).not.toHaveBeenCalled()
		expect(printed_errors()).toBe('')
	})

	it('exits zero without running self-update', () => {
		arrange_manifest_reads()
		mocked_execa_sync.mockReturnValue(fake_sync_result(0, `{"11.5.0":"${AGED_PUBLISH}"}`))

		expect(latest_corepack.main()).toBe(0)
		expect(mocked_execa_sync).toHaveBeenCalledTimes(1)
		expect(printed_errors()).toBe('')
	})
})

describe('latest_corepack.fail_self_update', () => {
	it('names the Corepack remedy when pnpm runs through the Corepack shim', () => {
		expect(latest_corepack.fail_self_update(FAILURE, { COREPACK_ROOT: '/corepack' })).toBe(FAILURE)
		expect(printed_errors()).toContain(COREPACK_CODE)
		expect(printed_errors()).toContain('corepack disable pnpm')
	})

	it('tells the Corepack user how a standalone pnpm of another version keeps working', () => {
		latest_corepack.fail_self_update(FAILURE, { COREPACK_ROOT: '/corepack' })

		expect(printed_errors()).toContain(
			'run josh sync so a devEngines.packageManager.onFail of "error" becomes "download"',
		)
	})

	it('reports only the exit status outside Corepack', () => {
		expect(latest_corepack.fail_self_update(FAILURE, {})).toBe(FAILURE)
		expect(printed_errors()).not.toContain(COREPACK_CODE)
		expect(printed_errors()).toContain(SELF_UPDATE_FAILURE)
	})
})
