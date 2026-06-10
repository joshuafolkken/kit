import { readFileSync, writeFileSync } from 'node:fs'
import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { latest_corepack } from './latest-corepack'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('node:fs', () => ({ readFileSync: vi.fn(), writeFileSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)
const mocked_read_file_sync = vi.mocked(readFileSync)
const mocked_write_file_sync = vi.mocked(writeFileSync)

type ExecaSyncResult = ReturnType<typeof execaSync>

function fake_sync_result(exit_code: number | undefined): ExecaSyncResult {
	const result = { exitCode: exit_code }

	return result as unknown as ExecaSyncResult
}

beforeEach(() => {
	vi.clearAllMocks()
})

const PACKAGE_JSON_V11 = '{"packageManager":"pnpm@11.4.0+sha512.abc"}'
const PACKAGE_JSON_V10 = '{"packageManager":"pnpm@10.34.1+sha512.def"}'
const PACKAGE_JSON_V11_SHORT = '{"packageManager":"pnpm@11"}'
const PACKAGE_JSON_NO_PM = '{"name":"kit"}'
const TARGET_V11 = 'pnpm@latest-11'

describe('latest_corepack.extract_pnpm_major', () => {
	it('extracts the major from a packageManager pnpm pin', () => {
		expect(latest_corepack.extract_pnpm_major(PACKAGE_JSON_V11)).toBe('11')
	})

	it('extracts the major from a bare pnpm@<major> shorthand pin', () => {
		expect(latest_corepack.extract_pnpm_major(PACKAGE_JSON_V11_SHORT)).toBe('11')
	})

	it('returns undefined when packageManager is absent', () => {
		expect(latest_corepack.extract_pnpm_major(PACKAGE_JSON_NO_PM)).toBeUndefined()
	})
})

describe('latest_corepack.build_corepack_target', () => {
	it('targets pnpm per-major latest dist-tag', () => {
		expect(latest_corepack.build_corepack_target('11')).toBe(TARGET_V11)
	})

	it('falls back to pnpm@latest when the major is undefined', () => {
		expect(latest_corepack.build_corepack_target(undefined)).toBe('pnpm@latest')
	})
})

describe('latest_corepack.resolve_corepack_target', () => {
	it('resolves a v11 pin to latest-11, never below devEngines', () => {
		expect(latest_corepack.resolve_corepack_target(PACKAGE_JSON_V11)).toBe(TARGET_V11)
	})

	it('resolves a v10 pin to latest-10, not the volatile latest tag', () => {
		expect(latest_corepack.resolve_corepack_target(PACKAGE_JSON_V10)).toBe('pnpm@latest-10')
	})
})

describe('latest_corepack.run_corepack', () => {
	it('returns 0 when corepack succeeds', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(0))

		expect(latest_corepack.run_corepack(TARGET_V11)).toBe(0)
	})

	it('returns the non-zero exit code from corepack', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(1))

		expect(latest_corepack.run_corepack(TARGET_V11)).toBe(1)
	})

	it('falls back to 1 when exitCode is undefined', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(undefined))

		expect(latest_corepack.run_corepack(TARGET_V11)).toBe(1)
	})
})

const PACKAGE_JSON_PATH = 'package.json'
const PACKAGE_JSON_WITH_ENGINES =
	'{"packageManager":"pnpm@11.5.0+sha512.abc","devEngines":{"packageManager":{"name":"pnpm","version":"11.5.0","onFail":"error"}}}'
const PACKAGE_JSON_WIDENED =
	'{"packageManager":"pnpm@11.5.0+sha512.abc","devEngines":{"packageManager":{"name":"pnpm","version":"11","onFail":"error"}}}'

describe('latest_corepack.widen_development_engines', () => {
	it('widens the devEngines pin to the bare major before the bump', () => {
		const is_widened = latest_corepack.widen_development_engines(PACKAGE_JSON_WITH_ENGINES, '11')

		expect(is_widened).toBe(true)
		expect(mocked_write_file_sync).toHaveBeenCalledWith(PACKAGE_JSON_PATH, PACKAGE_JSON_WIDENED)
	})

	it('does not touch the file when the major is undefined', () => {
		const is_widened = latest_corepack.widen_development_engines(
			PACKAGE_JSON_WITH_ENGINES,
			undefined,
		)

		expect(is_widened).toBe(false)
		expect(mocked_write_file_sync).not.toHaveBeenCalled()
	})

	it('does not touch the file when devEngines.packageManager is absent', () => {
		const is_widened = latest_corepack.widen_development_engines(PACKAGE_JSON_NO_PM, '11')

		expect(is_widened).toBe(false)
		expect(mocked_write_file_sync).not.toHaveBeenCalled()
	})
})

describe('latest_corepack.restore_package_json', () => {
	it('writes the original content back to package.json', () => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)

		latest_corepack.restore_package_json(PACKAGE_JSON_WITH_ENGINES)

		expect(mocked_write_file_sync).toHaveBeenCalledWith(
			PACKAGE_JSON_PATH,
			PACKAGE_JSON_WITH_ENGINES,
		)

		vi.restoreAllMocks()
	})
})

const PACKAGE_JSON_BUMPED =
	'{"packageManager":"pnpm@11.5.2+sha512.abc","devEngines":{"packageManager":{"name":"pnpm","version":"11","onFail":"error"}}}'
const WIDEN_CALL = [PACKAGE_JSON_PATH, PACKAGE_JSON_WIDENED]
const RESTORE_CALL = [PACKAGE_JSON_PATH, PACKAGE_JSON_WITH_ENGINES]

interface SyncSpy {
	mock: { invocationCallOrder: Array<number> }
}

function assert_called_before(earlier: SyncSpy, later: SyncSpy): void {
	const earlier_order = earlier.mock.invocationCallOrder[0] ?? 0
	const later_order = later.mock.invocationCallOrder[0] ?? 0

	expect(earlier_order).toBeLessThan(later_order)
}

describe('latest_corepack.main', () => {
	it('widens the devEngines pin before invoking corepack (the regression guard)', () => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		mocked_read_file_sync.mockReturnValueOnce(PACKAGE_JSON_WITH_ENGINES)
		mocked_read_file_sync.mockReturnValueOnce(PACKAGE_JSON_BUMPED)
		mocked_execa_sync.mockReturnValue(fake_sync_result(0))

		latest_corepack.main()

		expect(mocked_write_file_sync.mock.calls[0]).toEqual(WIDEN_CALL)
		assert_called_before(mocked_write_file_sync, mocked_execa_sync)

		vi.restoreAllMocks()
	})

	it('restores the original package.json when corepack skips the bump', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		mocked_read_file_sync.mockReturnValue(PACKAGE_JSON_WITH_ENGINES)
		mocked_execa_sync.mockReturnValue(fake_sync_result(1))

		latest_corepack.main()

		expect(mocked_write_file_sync.mock.calls[0]).toEqual(WIDEN_CALL)
		expect(mocked_write_file_sync.mock.calls[1]).toEqual(RESTORE_CALL)

		vi.restoreAllMocks()
	})
})

describe('latest_corepack.warn_if_skipped', () => {
	it('warns and reports a skip when corepack exits non-zero', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		expect(latest_corepack.warn_if_skipped(1)).toBe(true)
		expect(warn).toHaveBeenCalledOnce()

		warn.mockRestore()
	})

	it('stays silent and reports no skip when corepack succeeds', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		expect(latest_corepack.warn_if_skipped(0)).toBe(false)
		expect(warn).not.toHaveBeenCalled()

		warn.mockRestore()
	})
})
