import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawn_mock = vi.hoisted(() => vi.fn())
const read_mock = vi.hoisted(() => vi.fn())
const write_mock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ spawnSync: spawn_mock }))
vi.mock('node:fs', () => ({ readFileSync: read_mock, writeFileSync: write_mock }))

const { preinstall_version_update } = await import('./preinstall-version-update')

const PREINSTALL = 'pnpm dlx @aikidosec/safe-chain@1.5.1 setup-ci'
const NON_SAFE_CHAIN_PREINSTALL = 'some-other-cmd'
const PKG_WITH_SAFE_CHAIN = JSON.stringify({ scripts: { preinstall: PREINSTALL } })
const PKG_WITHOUT_PREINSTALL = JSON.stringify({ scripts: {} })
const PKG_WITHOUT_SAFE_CHAIN = JSON.stringify({
	scripts: { preinstall: NON_SAFE_CHAIN_PREINSTALL },
})
const PACKAGE_JSON_PATH = 'package.json'

beforeEach(() => {
	spawn_mock.mockReset()
	read_mock.mockReset()
	write_mock.mockReset()
})

describe('preinstall_version_update.extract_pinned_version', () => {
	it('extracts version from preinstall string', () => {
		expect(preinstall_version_update.extract_pinned_version(PREINSTALL)).toBe('1.5.1')
	})

	it('returns undefined when safe-chain is not in the string', () => {
		expect(
			preinstall_version_update.extract_pinned_version(NON_SAFE_CHAIN_PREINSTALL),
		).toBeUndefined()
	})
})

describe('preinstall_version_update.fetch_latest_version', () => {
	it('passes a timeout option to spawnSync', () => {
		spawn_mock.mockReturnValue({ status: 0, stdout: '1.5.1\n' })
		preinstall_version_update.fetch_latest_version()

		expect(spawn_mock).toHaveBeenCalledWith('npm', ['view', '@aikidosec/safe-chain', 'version'], {
			encoding: 'utf8',
			shell: false,
			timeout: 30_000,
		})
	})
})

describe('preinstall_version_update.rewrite_version', () => {
	it('replaces the pinned version in the content', () => {
		expect(preinstall_version_update.rewrite_version(PREINSTALL, '1.5.1', '2.0.0')).toBe(
			'pnpm dlx @aikidosec/safe-chain@2.0.0 setup-ci',
		)
	})
})

describe('preinstall_version_update.sync — no-op cases', () => {
	it('does nothing when preinstall script is missing', () => {
		read_mock.mockReturnValue(PKG_WITHOUT_PREINSTALL)
		preinstall_version_update.sync(PACKAGE_JSON_PATH)
		expect(write_mock).not.toHaveBeenCalled()
	})

	it('does nothing when safe-chain is not in preinstall', () => {
		read_mock.mockReturnValue(PKG_WITHOUT_SAFE_CHAIN)
		preinstall_version_update.sync(PACKAGE_JSON_PATH)
		expect(write_mock).not.toHaveBeenCalled()
	})

	it('warns and skips when npm view fails', () => {
		read_mock.mockReturnValue(PKG_WITH_SAFE_CHAIN)
		spawn_mock.mockReturnValue({ status: 1, stdout: '' })
		const warn_spy = vi.spyOn(console, 'warn')

		preinstall_version_update.sync(PACKAGE_JSON_PATH)
		expect(write_mock).not.toHaveBeenCalled()
		expect(warn_spy).toHaveBeenCalled()

		warn_spy.mockRestore()
	})

	it('does not write when version is already current', () => {
		read_mock.mockReturnValue(PKG_WITH_SAFE_CHAIN)
		spawn_mock.mockReturnValue({ status: 0, stdout: '1.5.1\n' })
		preinstall_version_update.sync(PACKAGE_JSON_PATH)
		expect(write_mock).not.toHaveBeenCalled()
	})
})

describe('preinstall_version_update.sync — write case', () => {
	it('writes updated content when a newer version is available', () => {
		read_mock.mockReturnValue(PKG_WITH_SAFE_CHAIN)
		spawn_mock.mockReturnValue({ status: 0, stdout: '2.0.0\n' })
		preinstall_version_update.sync(PACKAGE_JSON_PATH)
		expect(write_mock).toHaveBeenCalledWith(
			PACKAGE_JSON_PATH,
			expect.stringContaining('@aikidosec/safe-chain@2.0.0'),
			'utf8',
		)
	})
})
