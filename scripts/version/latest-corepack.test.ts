import { readFileSync, writeFileSync } from 'node:fs'
import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { latest_corepack } from './latest-corepack'
import {
	AGED_PUBLISH,
	fake_sync_result,
	NPMRC_AGE_1440,
	PACKAGE_JSON_PATH,
	QUARANTINED_PUBLISH,
} from './latest-corepack-fixture'
import { build_package_manager_manifest } from './package-manager-manifest-fixture'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('node:fs', () => ({ readFileSync: vi.fn(), writeFileSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)
const mocked_read_file_sync = vi.mocked(readFileSync)
const mocked_write_file_sync = vi.mocked(writeFileSync)

beforeEach(() => {
	// resetAllMocks, not clearAllMocks: a test that arranges mockReturnValueOnce values a code
	// path never consumes (e.g. the restore path skips the second read) would otherwise leak
	// its queued values into the next test's calls.
	vi.resetAllMocks()
})

const PACKAGE_JSON_V11 = '{"packageManager":"pnpm@11.4.0+sha512.abc"}'
const PACKAGE_JSON_V11_SHORT = '{"packageManager":"pnpm@11"}'
const PACKAGE_JSON_NO_PM = '{"name":"kit"}'
const REGISTRY_V11 = '11.19.0'
const SAFE_CHAIN_NOTICE =
	'ℹ Safe-chain: Some package versions were suppressed due to minimum age requirement.'

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

// The kit#766 floor's pure-comparison suites live in latest-corepack-floor.test.ts; this
// file keeps the query, resolve, corepack, and main() arrangements.

const FALLBACK_TARGET = 'pnpm@latest'
const TIMES_JSON_V11_OLD = `{"created":"2019-01-01T00:00:00.000Z","${REGISTRY_V11}":"${AGED_PUBLISH}"}`

describe('latest_corepack.extract_times_json', () => {
	it('parses the publish-timestamp object from clean output', () => {
		expect(latest_corepack.extract_times_json(TIMES_JSON_V11_OLD)).toMatchObject({
			[REGISTRY_V11]: AGED_PUBLISH,
		})
	})

	it('ignores the safe-chain age-filter notice sharing stdout with the payload', () => {
		const stdout = `${TIMES_JSON_V11_OLD}\n${SAFE_CHAIN_NOTICE}\n`

		expect(latest_corepack.extract_times_json(stdout)).toMatchObject({
			[REGISTRY_V11]: AGED_PUBLISH,
		})
	})

	it('returns undefined when stdout carries no JSON object', () => {
		expect(latest_corepack.extract_times_json(`${SAFE_CHAIN_NOTICE}\n`)).toBeUndefined()
	})

	it('returns undefined when the object is not a string-to-string record', () => {
		expect(latest_corepack.extract_times_json('{"11.19.0":42}')).toBeUndefined()
	})
})

describe('latest_corepack.query_major_latest_version', () => {
	it('asks the registry for publish timestamps and selects on the pinned major', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(0, TIMES_JSON_V11_OLD))
		mocked_read_file_sync.mockReturnValue(NPMRC_AGE_1440)

		expect(latest_corepack.query_major_latest_version('11')).toBe(REGISTRY_V11)
		expect(mocked_execa_sync).toHaveBeenCalledWith(
			'pnpm',
			['view', 'pnpm', 'time', '--json'],
			expect.objectContaining({ reject: false }),
		)
	})

	it('returns undefined when the registry query exits non-zero', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(1, ''))

		expect(latest_corepack.query_major_latest_version('11')).toBeUndefined()
	})

	it('treats an unreadable .npmrc as no quarantine instead of failing', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(0, TIMES_JSON_V11_OLD))
		mocked_read_file_sync.mockImplementation(() => {
			throw new Error('ENOENT')
		})

		expect(latest_corepack.query_major_latest_version('11')).toBe(REGISTRY_V11)
	})
})

describe('latest_corepack.resolve_corepack_target', () => {
	it('resolves to the exact registry version, not the unpublished latest-<major> tag', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(0, TIMES_JSON_V11_OLD))

		expect(latest_corepack.resolve_corepack_target('11')).toBe(`pnpm@${REGISTRY_V11}`)
	})

	it('falls back to pnpm@latest without querying when the major is unknown', () => {
		expect(latest_corepack.resolve_corepack_target(undefined)).toBe(FALLBACK_TARGET)
		expect(mocked_execa_sync).not.toHaveBeenCalled()
	})

	it('returns undefined when the registry cannot answer', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(1, ''))

		expect(latest_corepack.resolve_corepack_target('11')).toBeUndefined()
	})
})

const COREPACK_TARGET_V11 = `pnpm@${REGISTRY_V11}`

describe('latest_corepack.run_corepack', () => {
	it('returns 0 when corepack succeeds', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(0))

		expect(latest_corepack.run_corepack(COREPACK_TARGET_V11)).toBe(0)
	})

	it('returns the non-zero exit code from corepack', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(1))

		expect(latest_corepack.run_corepack(COREPACK_TARGET_V11)).toBe(1)
	})

	it('falls back to 1 when exitCode is undefined', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(undefined))

		expect(latest_corepack.run_corepack(COREPACK_TARGET_V11)).toBe(1)
	})
})

const PIN_V11_5_0 = '11.5.0+sha512.abc'
const MAJOR_V11 = '11'
const PACKAGE_JSON_WITH_ENGINES = build_package_manager_manifest(`pnpm@${PIN_V11_5_0}`, '11.5.0')
const PACKAGE_JSON_WIDENED = build_package_manager_manifest(`pnpm@${PIN_V11_5_0}`, MAJOR_V11)
// The same manifest with the two fields already byte-identical: the state the alignment
// closing main() converges on, so a run over it must not write at all.
const PACKAGE_JSON_ALIGNED = build_package_manager_manifest(`pnpm@${PIN_V11_5_0}`, PIN_V11_5_0)

describe('latest_corepack.did_widen_development_engines', () => {
	it('widens the devEngines pin to the bare major before the bump', () => {
		const is_widened = latest_corepack.did_widen_development_engines(
			PACKAGE_JSON_WITH_ENGINES,
			'11',
		)

		expect(is_widened).toBe(true)
		expect(mocked_write_file_sync).toHaveBeenCalledWith(PACKAGE_JSON_PATH, PACKAGE_JSON_WIDENED)
	})

	it('does not touch the file when the major is undefined', () => {
		const is_widened = latest_corepack.did_widen_development_engines(
			PACKAGE_JSON_WITH_ENGINES,
			undefined,
		)

		expect(is_widened).toBe(false)
		expect(mocked_write_file_sync).not.toHaveBeenCalled()
	})

	it('does not touch the file when devEngines.packageManager is absent', () => {
		const is_widened = latest_corepack.did_widen_development_engines(PACKAGE_JSON_NO_PM, '11')

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

const PACKAGE_JSON_BUMPED = build_package_manager_manifest('pnpm@11.5.2+sha512.abc', MAJOR_V11)
const WIDEN_CALL = [PACKAGE_JSON_PATH, PACKAGE_JSON_WIDENED]
const RESTORE_CALL = [PACKAGE_JSON_PATH, PACKAGE_JSON_WITH_ENGINES]
// 11.5.2 aged past any window; 11.6.0 published in the far future stays quarantined, so the
// selection exercises the native age filter on the main path too.
const VIEW_STDOUT = `{"11.5.2":"${AGED_PUBLISH}","11.6.0":"${QUARANTINED_PUBLISH}"}\n`
const TIMES_JSON_ALL_QUARANTINED = `{"11.5.2":"${QUARANTINED_PUBLISH}"}`

interface SyncSpy {
	mock: { invocationCallOrder: Array<number> }
}

function invocation_order(spy: SyncSpy, call_index: number): number {
	return spy.mock.invocationCallOrder[call_index] ?? 0
}

function silence_console(): void {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
}

// Arrange a resolved registry answer (11.5.2), then corepack exiting with the given code.
// Reads arrive in main's order: package.json, then .npmrc (quarantine window), then the
// re-read taken by the alignment that closes main() — `on_disk` is what the file holds at
// that point, the bumped manifest on success and the restored one on a skip.
function arrange_resolved_registry(corepack_exit_code: number, on_disk: string): void {
	mocked_read_file_sync.mockReturnValueOnce(PACKAGE_JSON_WITH_ENGINES)
	mocked_read_file_sync.mockReturnValueOnce(NPMRC_AGE_1440)
	mocked_read_file_sync.mockReturnValueOnce(on_disk)
	mocked_execa_sync.mockReturnValueOnce(fake_sync_result(0, VIEW_STDOUT))
	mocked_execa_sync.mockReturnValueOnce(fake_sync_result(corepack_exit_code))
}

describe('latest_corepack.main', () => {
	it('invokes corepack with the registry-resolved exact version, never a dist-tag', () => {
		silence_console()
		arrange_resolved_registry(0, PACKAGE_JSON_BUMPED)

		latest_corepack.main()

		expect(mocked_execa_sync).toHaveBeenLastCalledWith(
			'corepack',
			['use', 'pnpm@11.5.2'],
			expect.objectContaining({ reject: false }),
		)

		vi.restoreAllMocks()
	})

	it('widens the devEngines pin before invoking corepack (the regression guard)', () => {
		silence_console()
		arrange_resolved_registry(0, PACKAGE_JSON_BUMPED)

		latest_corepack.main()

		expect(mocked_write_file_sync.mock.calls[0]).toEqual(WIDEN_CALL)
		expect(invocation_order(mocked_write_file_sync, 0)).toBeLessThan(
			invocation_order(mocked_execa_sync, 1),
		)

		vi.restoreAllMocks()
	})

	it('restores the original package.json when corepack skips the bump', () => {
		silence_console()
		arrange_resolved_registry(1, PACKAGE_JSON_WITH_ENGINES)

		latest_corepack.main()

		expect(mocked_write_file_sync.mock.calls[0]).toEqual(WIDEN_CALL)
		expect(mocked_write_file_sync.mock.calls[1]).toEqual(RESTORE_CALL)

		vi.restoreAllMocks()
	})
})

// kit#773: the restored state is the pre-run manifest, drift included, so the alignment
// closing main() still has to repair it. The no-bump paths are covered in
// latest-corepack-drift.test.ts.
describe('latest_corepack.main alignment', () => {
	it('aligns the restored manifest when the pre-run state carried a devEngines drift', () => {
		silence_console()
		arrange_resolved_registry(1, PACKAGE_JSON_WITH_ENGINES)

		latest_corepack.main()

		expect(mocked_write_file_sync.mock.calls[2]).toEqual([PACKAGE_JSON_PATH, PACKAGE_JSON_ALIGNED])

		vi.restoreAllMocks()
	})
})

// Aligned on purpose: these suites assert that a skipped bump writes nothing, which only
// isolates the skip when there is no devEngines drift left for the alignment to repair.
const PIN_V11_20_0 = '11.20.0+sha512.abc'
const PACKAGE_JSON_AHEAD_OF_REGISTRY = build_package_manager_manifest(
	`pnpm@${PIN_V11_20_0}`,
	PIN_V11_20_0,
)

describe('latest_corepack.main skip handling', () => {
	// The kit#766 regression: an age-filtered registry view answers one release below the
	// pin. The run must be a no-op, not a downgrade. The .npmrc read receives the
	// package.json content and parses to no quarantine, which is exactly the point: the
	// floor holds regardless of what the age filter did.
	it('skips without invoking corepack when the registry answers below the pin', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		mocked_read_file_sync.mockReturnValue(PACKAGE_JSON_AHEAD_OF_REGISTRY)
		mocked_execa_sync.mockReturnValue(fake_sync_result(0, TIMES_JSON_V11_OLD))

		latest_corepack.main()

		expect(mocked_execa_sync).toHaveBeenCalledTimes(1)
		expect(mocked_write_file_sync).not.toHaveBeenCalled()
		expect(warn).toHaveBeenCalledOnce()

		warn.mockRestore()
	})

	// The kit#768 acceptance case: every release on the major is still inside the quarantine
	// window, so nothing qualifies and the bump is skipped with package.json untouched.
	it('skips without touching package.json when every release is still quarantined', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		mocked_read_file_sync.mockReturnValueOnce(PACKAGE_JSON_ALIGNED)
		mocked_read_file_sync.mockReturnValueOnce(NPMRC_AGE_1440)
		mocked_read_file_sync.mockReturnValueOnce(PACKAGE_JSON_ALIGNED)
		mocked_execa_sync.mockReturnValue(fake_sync_result(0, TIMES_JSON_ALL_QUARANTINED))

		latest_corepack.main()

		expect(mocked_execa_sync).toHaveBeenCalledTimes(1)
		expect(mocked_write_file_sync).not.toHaveBeenCalled()
		expect(warn).toHaveBeenCalledOnce()

		warn.mockRestore()
	})

	it('skips without touching package.json when the registry cannot answer', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		mocked_read_file_sync.mockReturnValue(PACKAGE_JSON_ALIGNED)
		mocked_execa_sync.mockReturnValue(fake_sync_result(1, ''))

		latest_corepack.main()

		expect(mocked_execa_sync).toHaveBeenCalledTimes(1)
		expect(mocked_write_file_sync).not.toHaveBeenCalled()
		expect(warn).toHaveBeenCalledOnce()

		warn.mockRestore()
	})
})

describe('latest_corepack.did_warn_skip', () => {
	it('warns and reports a skip when corepack exits non-zero', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		expect(latest_corepack.did_warn_skip(1)).toBe(true)
		expect(warn).toHaveBeenCalledOnce()

		warn.mockRestore()
	})

	it('stays silent and reports no skip when corepack succeeds', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		expect(latest_corepack.did_warn_skip(0)).toBe(false)
		expect(warn).not.toHaveBeenCalled()

		warn.mockRestore()
	})
})
