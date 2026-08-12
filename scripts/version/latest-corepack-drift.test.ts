import { readFileSync, writeFileSync } from 'node:fs'
import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { latest_corepack } from './latest-corepack'
import {
	AGED_PUBLISH,
	fake_sync_result,
	NPMRC_AGE_1440,
	NPMRC_PATH,
	PACKAGE_JSON_PATH,
	QUARANTINED_PUBLISH,
} from './latest-corepack-fixture'
import { build_package_manager_manifest } from './package-manager-manifest-fixture'

// The kit#773 regression: `devEngines.packageManager.version` used to be realigned only
// after a successful bump. An up-to-date repository never bumps, so a manifest that
// arrived with the two fields out of step never self-healed and pnpm kept printing the
// dual-declaration warning on every invocation. main() now aligns on every path.
vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('node:fs', () => ({ readFileSync: vi.fn(), writeFileSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)
const mocked_read_file_sync = vi.mocked(readFileSync)
const mocked_write_file_sync = vi.mocked(writeFileSync)

const PINNED_VERSION = '11.21.0'
const PINNED_PIN = `${PINNED_VERSION}+sha512.abc`
const TIMES_JSON_AT_PIN = `{"created":"2019-01-01T00:00:00.000Z","${PINNED_VERSION}":"${AGED_PUBLISH}"}`
const TIMES_JSON_ALL_QUARANTINED = `{"11.22.0":"${QUARANTINED_PUBLISH}"}`
// The state observed in game-kit#416: the pin carries the Corepack integrity suffix, the
// devEngines version is the bare version an older kit release wrote.
const PACKAGE_JSON_DRIFTED = build_package_manager_manifest(`pnpm@${PINNED_PIN}`, PINNED_VERSION)
const PACKAGE_JSON_REPAIRED = build_package_manager_manifest(`pnpm@${PINNED_PIN}`, PINNED_PIN)
const REPAIR_CALL = [PACKAGE_JSON_PATH, PACKAGE_JSON_REPAIRED]

// main reads package.json twice (once up front, once inside the alignment) with the
// `.npmrc` quarantine window in between; no bump happens in any case below, so the
// manifest content stays the same across both reads.
function arrange_reads(package_json_content: string): void {
	mocked_read_file_sync.mockImplementation((path: unknown) =>
		path === NPMRC_PATH ? NPMRC_AGE_1440 : package_json_content,
	)
}

beforeEach(() => {
	vi.resetAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('latest_corepack.main devEngines drift repair', () => {
	it('repairs the drift when the pin already matches the newest registry release', () => {
		arrange_reads(PACKAGE_JSON_DRIFTED)
		mocked_execa_sync.mockReturnValue(fake_sync_result(0, TIMES_JSON_AT_PIN))

		latest_corepack.main()

		// A single execa call means the registry query alone ran: corepack is never
		// invoked, so the write below is the alignment and nothing else.
		expect(mocked_execa_sync).toHaveBeenCalledTimes(1)
		expect(mocked_write_file_sync.mock.calls).toEqual([REPAIR_CALL])
	})

	it('repairs the drift even when the registry cannot answer', () => {
		arrange_reads(PACKAGE_JSON_DRIFTED)
		mocked_execa_sync.mockReturnValue(fake_sync_result(1, ''))

		latest_corepack.main()

		expect(mocked_write_file_sync.mock.calls).toEqual([REPAIR_CALL])
	})

	it('repairs the drift when every release is still inside the quarantine window', () => {
		arrange_reads(PACKAGE_JSON_DRIFTED)
		mocked_execa_sync.mockReturnValue(fake_sync_result(0, TIMES_JSON_ALL_QUARANTINED))

		latest_corepack.main()

		expect(mocked_write_file_sync.mock.calls).toEqual([REPAIR_CALL])
	})

	it('writes nothing when the two fields already match', () => {
		arrange_reads(PACKAGE_JSON_REPAIRED)
		mocked_execa_sync.mockReturnValue(fake_sync_result(0, TIMES_JSON_AT_PIN))

		latest_corepack.main()

		expect(mocked_write_file_sync).not.toHaveBeenCalled()
	})
})
