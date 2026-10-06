import { beforeEach, describe, expect, it, vi } from 'vitest'

const execa_sync_mock = vi.hoisted(() => vi.fn())
const ci_pin_sync_mock = vi.hoisted(() => vi.fn())
const read_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execaSync: execa_sync_mock }))
vi.mock('#scripts/safe-chain/ci-installer-pin', () => ({
	ci_installer_pin: { sync: ci_pin_sync_mock },
}))
vi.mock('#scripts/lib/read-file', () => ({ file_reader: { read_if_readable: read_mock } }))

const PACKAGE_JSON_PATH = 'package.json'
const KIT_MANIFEST = JSON.stringify({ name: '@joshuafolkken/kit' })

const { safe_chain_version_update } = await import('./safe-chain-version-update')

beforeEach(() => {
	execa_sync_mock.mockReset()
	ci_pin_sync_mock.mockReset()
	read_mock.mockReset()
	read_mock.mockReturnValue(KIT_MANIFEST)
})

describe('safe_chain_version_update.fetch_latest_version', () => {
	it('passes a timeout option to execaSync', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 0, stdout: '1.5.1\n' })
		safe_chain_version_update.fetch_latest_version()

		expect(execa_sync_mock).toHaveBeenCalledWith(
			'npm',
			['view', '@aikidosec/safe-chain', 'version'],
			{ reject: false, timeout: 30_000 },
		)
	})

	it('returns the trimmed version', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 0, stdout: '2.0.0\n' })

		expect(safe_chain_version_update.fetch_latest_version()).toBe('2.0.0')
	})

	// joshuafolkken/kit#3266: the registry's answer reaches workflow files and a download URL.
	it.each(['2.0.0; rm -rf ~', 'latest', '2.0.0/../evil'])('rejects %s', (stdout) => {
		execa_sync_mock.mockReturnValue({ exitCode: 0, stdout })

		expect(safe_chain_version_update.fetch_latest_version()).toBeUndefined()
	})
})

describe('safe_chain_version_update.sync', () => {
	// joshuafolkken/kit#2711: the CI workflows install the release, so they move with it.
	it('hands the fetched release to the CI installer pin', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 0, stdout: '2.0.0\n' })
		safe_chain_version_update.sync(PACKAGE_JSON_PATH)

		expect(ci_pin_sync_mock).toHaveBeenCalledWith('2.0.0')
	})

	it('warns and skips the CI pin when npm view fails', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 1, stdout: '' })
		const warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => {
			/* suppress */
		})

		safe_chain_version_update.sync(PACKAGE_JSON_PATH)

		expect(ci_pin_sync_mock).not.toHaveBeenCalled()
		expect(warn_spy).toHaveBeenCalled()
		warn_spy.mockRestore()
	})

	it('skips the CI pin when the registry answers something that is not a version', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 0, stdout: 'not-a-version' })
		vi.spyOn(console, 'warn').mockImplementation(() => {
			/* suppress */
		})

		safe_chain_version_update.sync(PACKAGE_JSON_PATH)

		expect(ci_pin_sync_mock).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#3269: the pinned workflows are kit-distributed, so a consumer bumping its copy
	// would be reverted by the next `josh sync`.
	it.each([
		['a consumer manifest', JSON.stringify({ name: 'my-app' })],
		['an unreadable manifest', undefined],
		['a manifest that is not JSON', '{'],
	])('leaves the CI pin alone for %s', (_label, manifest) => {
		read_mock.mockReturnValue(manifest)
		safe_chain_version_update.sync(PACKAGE_JSON_PATH)

		expect(execa_sync_mock).not.toHaveBeenCalled()
		expect(ci_pin_sync_mock).not.toHaveBeenCalled()
	})
})
